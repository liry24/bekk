use std::{fs, io::ErrorKind, sync::Mutex, time::{Duration, Instant}};

use anyhow::{Result, anyhow};
use bytesize::ByteSize;
use chrono::{Datelike, Local, NaiveTime, Weekday};
use clap::{Parser, Subcommand};
use rustic_backend::BackendOptions;
use rustic_core::repofile::KeyId;
use rustic_core::{
    BackupOptions, CheckOptions, ConfigOptions, Credentials, KeyOptions, LocalDestination,
    LsOptions, OpenStatus, PathList, PruneOptions, PrunePlan, Progress, ProgressBars, ProgressType,
    RepairIndexOptions, Repository, RepositoryOptions, RestoreOptions, RusticProgress,
    SnapshotOptions,
};
use serde_json::{Value, json};

// ─── CLI ─────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "bekk-core", about = "rustic-backed backup engine for bekk")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
    #[arg(long, help = "Read repository password from stdin")]
    password_stdin: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new backup repository
    Init {
        #[arg(long, help = "Path to the repository")]
        repo: String,
        #[arg(
            long,
            help = "Delete existing local repository contents before initializing"
        )]
        force_reinit: bool,
        #[arg(
            long,
            default_value_t = 1,
            help = "Compression level (0=none, -7 to 22)"
        )]
        compression: i32,
        #[arg(long, help = "Disable extra verification before upload")]
        no_extra_verify: bool,
        #[arg(long, default_value_t = 32, help = "Data pack size in MiB")]
        pack_size: u64,
        #[arg(long, default_value_t = 1, help = "Average chunk size in MiB")]
        chunk_size: u64,
    },
    /// Back up source paths into the repository
    Backup {
        #[arg(long, help = "Path to the repository")]
        repo: String,
        #[arg(long = "source", required = true, help = "Source path (repeatable)")]
        sources: Vec<String>,
        #[arg(long, help = "Dry run — show what would be done without writing")]
        dry_run: bool,
        #[arg(long, help = "Tag to attach to the snapshot")]
        tag: Option<String>,
        #[arg(long, help = "Emit JSON Lines progress to stdout")]
        progress: bool,
        #[arg(long, default_value_t = 1, help = "Maximum snapshots to keep (oldest deleted first)")]
        snapshot_limit: usize,
    },
    /// Restore from the repository to a target directory
    Restore {
        #[arg(long, help = "Path to the repository")]
        repo: String,
        #[arg(
            long,
            default_value = "latest",
            help = "Snapshot ID or 'latest' (default)"
        )]
        snapshot: String,
        #[arg(long, help = "Target directory to restore into")]
        target: String,
        #[arg(long, help = "Dry run — show what would be done without writing")]
        dry_run: bool,
    },
    /// List snapshots in the repository
    Snapshots {
        #[arg(long, help = "Path to the repository")]
        repo: String,
    },
    /// Change the repository password (re-key)
    ChangePassword {
        #[arg(long, help = "Path to the repository")]
        repo: String,
    },
    /// Apply repository config options to an existing repository
    ApplyConfig {
        #[arg(long, help = "Path to the repository")]
        repo: String,
        #[arg(
            long,
            default_value_t = 1,
            help = "Compression level (0=none, -7 to 22)"
        )]
        compression: i32,
        #[arg(long, help = "Disable extra verification before upload")]
        no_extra_verify: bool,
        #[arg(long, default_value_t = 32, help = "Data pack size in MiB")]
        pack_size: u64,
        #[arg(long, default_value_t = 1, help = "Average chunk size in MiB")]
        chunk_size: u64,
    },
    /// Prune orphaned blobs, check repository, and repair index
    Clean {
        #[arg(long, help = "Path to the repository")]
        repo: String,
        #[arg(long, help = "Dry run — show what would be pruned without writing")]
        dry_run: bool,
        #[arg(long, help = "Delete files immediately instead of marking them")]
        instant_delete: bool,
    },
    /// Compute next run time for a given schedule
    ScheduleInfo {
        #[arg(long, help = "Daily schedule HH:MM")]
        daily: Option<String>,
        #[arg(long, num_args = 2, value_names = ["DOW", "TIME"], help = "Weekly schedule DOW HH:MM")]
        weekly: Vec<String>,
        #[arg(long, num_args = 2, value_names = ["DAY", "TIME"], help = "Monthly schedule DAY HH:MM")]
        monthly: Vec<String>,
        #[arg(long, help = "Interval in minutes")]
        interval: Option<u32>,
    },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn read_password(stdin: bool) -> Result<String> {
    if !stdin {
        return Err(anyhow!(
            "Password must be provided via stdin (use --password-stdin)"
        ));
    }
    let mut password = String::new();
    std::io::stdin().read_line(&mut password)?;
    Ok(password.trim_end_matches('\n').trim_end_matches('\r').to_string())
}

fn make_backends(repo: &str) -> Result<rustic_core::RepositoryBackends> {
    let backends = BackendOptions::default().repository(repo).to_backends()?;
    Ok(backends)
}

fn open_repo(repo: &str, password: &str) -> Result<Repository<OpenStatus>> {
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    Ok(Repository::new(&repo_opts, &backends)?.open(&credentials)?)
}

fn open_repo_with_progress(repo: &str, password: &str, pb: impl ProgressBars) -> Result<Repository<OpenStatus>> {
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    Ok(Repository::new_with_progress(&repo_opts, &backends, pb)?.open(&credentials)?)
}

// ─── JSON Progress Bars ──────────────────────────────────────────────────────

#[derive(Debug)]
struct JsonProgress {
    prefix: String,
    progress_type: ProgressType,
    last_emit: Mutex<Instant>,
}

impl JsonProgress {
    fn emit(&self, event: Value) {
        let mut last = self.last_emit.lock().unwrap();
        if last.elapsed() >= Duration::from_millis(50) {
            println!("{}", event);
            *last = Instant::now();
        }
    }

    fn progress_type_str(&self) -> &'static str {
        match self.progress_type {
            ProgressType::Spinner => "spinner",
            ProgressType::Counter => "counter",
            ProgressType::Bytes => "bytes",
        }
    }
}

impl RusticProgress for JsonProgress {
    fn is_hidden(&self) -> bool { false }
    fn set_length(&self, len: u64) {
        self.emit(json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "set_length",
            "length": len
        }));
    }
    fn set_title(&self, title: &str) {
        self.emit(json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "set_title",
            "title": title
        }));
    }
    fn inc(&self, inc: u64) {
        self.emit(json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "inc",
            "increment": inc
        }));
    }
    fn finish(&self) {
        println!("{}", json!({
            "type": "progress",
            "phase": self.prefix,
            "progress_type": self.progress_type_str(),
            "action": "finish"
        }));
    }
}

#[derive(Debug)]
struct JsonProgressBars;

impl ProgressBars for JsonProgressBars {
    fn progress(&self, progress_type: ProgressType, prefix: &str) -> Progress {
        Progress::new(JsonProgress {
            prefix: prefix.to_string(),
            progress_type,
            last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
        })
    }
}

fn ok() -> Value {
    json!({ "status": "ok" })
}

fn ok_data(data: Value) -> Value {
    json!({ "status": "ok", "data": data })
}

fn err(msg: String) -> Value {
    json!({ "status": "error", "message": msg })
}

// ─── Commands ────────────────────────────────────────────────────────────────

fn build_config_opts(
    compression: i32,
    no_extra_verify: bool,
    pack_size: u64,
    chunk_size: u64,
) -> ConfigOptions {
    ConfigOptions::default()
        .set_compression(Some(compression))
        .set_extra_verify(Some(!no_extra_verify))
        .set_datapack_size(Some(ByteSize::mib(pack_size)))
        .set_chunk_size(Some(ByteSize::mib(chunk_size)))
}

fn cmd_init(
    repo: &str,
    force_reinit: bool,
    compression: i32,
    no_extra_verify: bool,
    pack_size: u64,
    chunk_size: u64,
    password_stdin: bool,
) -> Result<Value> {
    if force_reinit {
        reset_local_repo_for_reinit(repo)?;
    }

    let password = read_password(password_stdin)?;
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    let key_opts = KeyOptions::default();
    let config_opts = build_config_opts(compression, no_extra_verify, pack_size, chunk_size);

    Repository::new(&repo_opts, &backends)?.init(&credentials, &key_opts, &config_opts)?;

    Ok(ok())
}

fn local_repo_path(repo: &str) -> Option<&str> {
    if let Some(path) = repo.strip_prefix("local:") {
        return Some(path);
    }

    if repo.contains(':') {
        return None;
    }

    Some(repo)
}

fn is_windows_drive_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    (bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || (bytes.len() == 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\'))
}

fn reset_local_repo_for_reinit(repo: &str) -> Result<()> {
    let path = local_repo_path(repo)
        .ok_or_else(|| anyhow!("--force-reinit is only supported for local repository paths"))?;

    if path.is_empty() || path == "/" || is_windows_drive_root(path) {
        return Err(anyhow!("Refusing to delete a root repository path"));
    }

    match fs::metadata(path) {
        Ok(meta) => {
            if meta.is_dir() {
                fs::remove_dir_all(path)?;
            } else {
                fs::remove_file(path)?;
            }
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => return Err(err.into()),
    }

    fs::create_dir_all(path)?;
    Ok(())
}

fn cmd_change_password(repo: &str, password_stdin: bool) -> Result<Value> {
    let old_password = read_password(password_stdin)?;
    let new_password = read_password(password_stdin)?;

    if old_password == new_password {
        return Err(anyhow!(
            "New password must differ from the current password"
        ));
    }

    let opened = open_repo(repo, &old_password)?;
    let old_key_id: Option<KeyId> = opened.key_id().clone();
    opened.add_key(&new_password, &KeyOptions::default())?;
    if let Some(kid) = old_key_id {
        // Re-open with new credentials to authenticate the delete
        let reopened = open_repo(repo, &new_password)?;
        // Guard: skip deletion if rustic resolved to the same key (should not happen
        // after the early-return above, but defensive against edge cases)
        if reopened.key_id().as_ref() != Some(&kid) {
            reopened.delete_key(&kid)?;
        }
    }

    Ok(ok())
}

fn cmd_apply_config(
    repo: &str,
    compression: i32,
    no_extra_verify: bool,
    pack_size: u64,
    chunk_size: u64,
    password_stdin: bool,
) -> Result<Value> {
    let password = read_password(password_stdin)?;
    let config_opts = build_config_opts(compression, no_extra_verify, pack_size, chunk_size);

    let mut repo = open_repo(repo, &password)?;
    repo.apply_config(&config_opts)?;

    Ok(ok())
}

fn cmd_clean(repo: &str, dry_run: bool, instant_delete: bool, password_stdin: bool) -> Result<Value> {
    let password = read_password(password_stdin)?;
    let repo = open_repo(repo, &password)?;

    // 1. Prune
    let prune_opts = PruneOptions::default().instant_delete(instant_delete);
    let plan = PrunePlan::from_prune_options(&repo, &prune_opts)?;

    let prune_data = if dry_run {
        json!({
            "unreferenced_packs": plan.stats.packs_unref,
            "unreferenced_size": plan.stats.size_unref,
        })
    } else {
        repo.prune(&prune_opts, plan)?;
        json!({ "ok": true })
    };

    // 2. Check (skip if dry_run)
    let check_data = if dry_run {
        serde_json::Value::Null
    } else {
        let check_results = repo.check(CheckOptions::default())?;
        let errors: Vec<Value> = check_results
            .0
            .iter()
            .map(|(level, err)| {
                json!({
                    "level": format!("{:?}", level),
                    "message": format!("{:?}", err),
                })
            })
            .collect();
        // check_results.is_ok() returns a Result<(), _>, so we call is_ok() again
        // to obtain a plain bool indicating whether the repository check passed.
        json!({
            "ok": check_results.is_ok().is_ok(),
            "errors": errors,
        })
    };

    // 3. Repair Index (skip if dry_run)
    let repair_data = if dry_run {
        serde_json::Value::Null
    } else {
        repo.repair_index(&RepairIndexOptions::default().read_all(false), false)?;
        json!({ "ok": true })
    };

    Ok(ok_data(json!({
        "prune": prune_data,
        "check": check_data,
        "repair_index": repair_data,
    })))
}

fn cmd_backup(
    repo: &str,
    sources: &[String],
    dry_run: bool,
    tag: Option<&str>,
    password_stdin: bool,
    progress: bool,
    snapshot_limit: usize,
) -> Result<Value> {
    let password = read_password(password_stdin)?;

    let repo = if progress {
        open_repo_with_progress(repo, &password, JsonProgressBars)?
    } else {
        open_repo(repo, &password)?
    };
    let repo = repo.to_indexed_ids()?;

    let mut snap_opts = SnapshotOptions::default();
    if let Some(t) = tag {
        snap_opts = snap_opts.add_tags(t)?;
    }
    let snap = snap_opts.to_snapshot()?;

    let backup_opts = BackupOptions::default().dry_run(dry_run);
    let source: PathList = sources.iter().map(String::as_str).collect();

    let snap = repo.backup(&backup_opts, &source, snap)?;

    // Prune oldest snapshots if over limit (after successful backup)
    if !dry_run && snapshot_limit > 0 {
        let mut snaps = repo.get_all_snapshots()?;
        snaps.sort_by(|a, b| a.time.cmp(&b.time));
        if snaps.len() > snapshot_limit {
            let to_delete: Vec<_> = snaps
                .iter()
                .take(snaps.len() - snapshot_limit)
                .map(|s| s.id)
                .collect();
            if !to_delete.is_empty() {
                repo.delete_snapshots(&to_delete)?;
            }
        }
    }

    Ok(ok_data(json!({
        "snapshot_id": (*snap.id).to_hex().as_str().to_string(),
        "time": snap.time.strftime("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        "paths": snap.paths.iter().collect::<Vec<_>>(),
    })))
}

fn cmd_restore(
    repo: &str,
    snapshot: &str,
    target: &str,
    dry_run: bool,
    password_stdin: bool,
) -> Result<Value> {
    let password = read_password(password_stdin)?;

    let repo = open_repo(repo, &password)?.to_indexed()?;

    let node = repo.node_from_snapshot_path(snapshot, |_| true)?;
    let dest = LocalDestination::new(target, true, !node.is_dir())?;
    let ls_opts = LsOptions::default();
    let restore_opts = RestoreOptions::default();

    let node_streamer = repo.ls(&node, &ls_opts)?;
    let plan = repo.prepare_restore(&restore_opts, node_streamer.clone(), &dest, dry_run)?;

    if !dry_run {
        repo.restore(plan, &restore_opts, node_streamer, &dest)?;
    }

    Ok(ok())
}

fn cmd_snapshots(repo: &str, password_stdin: bool) -> Result<Value> {
    let password = read_password(password_stdin)?;

    let repo = open_repo(repo, &password)?;
    let mut snaps = repo.get_all_snapshots()?;
    snaps.sort_by(|a, b| a.time.cmp(&b.time));

    let snap_list: Vec<Value> = snaps
        .iter()
        .map(|s| {
            json!({
                "id": (*s.id).to_hex().as_str().to_string(),
                "time": s.time.strftime("%Y-%m-%dT%H:%M:%S%:z").to_string(),
                "paths": s.paths.iter().collect::<Vec<_>>(),
                "tags": s.tags.iter().collect::<Vec<_>>(),
                "hostname": s.hostname,
                "username": s.username,
            })
        })
        .collect();

    Ok(ok_data(json!(snap_list)))
}

// ─── Schedule Info ───────────────────────────────────────────────────────────

fn parse_time(s: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M")
        .map_err(|_| anyhow!("Invalid time format: {}. Expected HH:MM", s))
}

fn parse_dow(s: &str) -> Result<Weekday> {
    match s.to_ascii_lowercase().as_str() {
        "mon" | "monday" => Ok(Weekday::Mon),
        "tue" | "tuesday" => Ok(Weekday::Tue),
        "wed" | "wednesday" => Ok(Weekday::Wed),
        "thu" | "thursday" => Ok(Weekday::Thu),
        "fri" | "friday" => Ok(Weekday::Fri),
        "sat" | "saturday" => Ok(Weekday::Sat),
        "sun" | "sunday" => Ok(Weekday::Sun),
        _ => Err(anyhow!("Invalid day of week: {}", s)),
    }
}

fn next_daily(now: chrono::DateTime<Local>, time: NaiveTime) -> Result<chrono::DateTime<Local>> {
    let candidate = now
        .date_naive()
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))?;
    if candidate > now {
        Ok(candidate)
    } else {
        Ok(candidate + chrono::Duration::days(1))
    }
}

fn next_weekly(
    now: chrono::DateTime<Local>,
    dow: Weekday,
    time: NaiveTime,
) -> Result<chrono::DateTime<Local>> {
    let today_dow = now.weekday();
    let current_num = today_dow.number_from_monday() as i32;
    let target_num = dow.number_from_monday() as i32;
    let mut days_ahead = (target_num - current_num + 7) % 7;

    let candidate = now
        .date_naive()
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))?;

    if days_ahead == 0 {
        if candidate > now {
            return Ok(candidate);
        }
        days_ahead = 7;
    }

    let next_date = now + chrono::Duration::days(days_ahead as i64);
    next_date
        .date_naive()
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))
}

fn next_monthly(
    now: chrono::DateTime<Local>,
    day: u32,
    time: NaiveTime,
) -> Result<chrono::DateTime<Local>> {
    let candidate_date = now
        .date_naive()
        .with_day(day)
        .ok_or_else(|| anyhow!("Invalid day {} for current month", day))?;
    let candidate = candidate_date
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))?;

    if candidate > now {
        return Ok(candidate);
    }

    let next_year = if now.month() == 12 {
        now.year() + 1
    } else {
        now.year()
    };
    let next_month = if now.month() == 12 { 1 } else { now.month() + 1 };
    let next_date =
        chrono::NaiveDate::from_ymd_opt(next_year, next_month, day)
            .ok_or_else(|| anyhow!("Invalid day {} for next month", day))?;

    next_date
        .and_time(time)
        .and_local_timezone(now.timezone())
        .single()
        .ok_or_else(|| anyhow!("Invalid local time"))
}

fn next_interval(
    now: chrono::DateTime<Local>,
    minutes: u32,
) -> Result<chrono::DateTime<Local>> {
    Ok(now + chrono::Duration::minutes(minutes as i64))
}

fn cmd_schedule_info(
    daily: Option<String>,
    weekly: Vec<String>,
    monthly: Vec<String>,
    interval: Option<u32>,
) -> Result<Value> {
    let now = Local::now();
    let next = if let Some(t) = daily {
        let time = parse_time(&t)?;
        next_daily(now, time)?
    } else if weekly.len() == 2 {
        let dow = parse_dow(&weekly[0])?;
        let time = parse_time(&weekly[1])?;
        next_weekly(now, dow, time)?
    } else if monthly.len() == 2 {
        let day: u32 = monthly[0]
            .parse()
            .map_err(|_| anyhow!("Invalid day: {}", monthly[0]))?;
        let time = parse_time(&monthly[1])?;
        next_monthly(now, day, time)?
    } else if let Some(mins) = interval {
        next_interval(now, mins)?
    } else {
        return Err(anyhow!(
            "No schedule specified. Use --daily, --weekly, --monthly, or --interval"
        ));
    };

    Ok(ok_data(json!({
        "next_run": next.to_rfc3339(),
    })))
}

// ─── Entry point ─────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init {
            repo,
            force_reinit,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
        } => cmd_init(
            &repo,
            force_reinit,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
            cli.password_stdin,
        ),
        Commands::Backup {
            repo,
            sources,
            dry_run,
            tag,
            progress,
            snapshot_limit,
        } => cmd_backup(&repo, &sources, dry_run, tag.as_deref(), cli.password_stdin, progress, snapshot_limit),
        Commands::Restore {
            repo,
            snapshot,
            target,
            dry_run,
        } => cmd_restore(&repo, &snapshot, &target, dry_run, cli.password_stdin),
        Commands::Snapshots { repo } => cmd_snapshots(&repo, cli.password_stdin),
        Commands::ChangePassword { repo } => cmd_change_password(&repo, cli.password_stdin),
        Commands::ApplyConfig {
            repo,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
        } => cmd_apply_config(
            &repo,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
            cli.password_stdin,
        ),
        Commands::Clean {
            repo,
            dry_run,
            instant_delete,
        } => cmd_clean(&repo, dry_run, instant_delete, cli.password_stdin),
        Commands::ScheduleInfo {
            daily,
            weekly,
            monthly,
            interval,
        } => cmd_schedule_info(daily, weekly, monthly, interval),
    };

    match result {
        Ok(v) => println!("{v}"),
        Err(e) => {
            println!("{}", err(e.to_string()));
            std::process::exit(1);
        }
    }
}
