use std::{fs, io::ErrorKind};

use anyhow::{Result, anyhow};
use bytesize::ByteSize;
use clap::{Parser, Subcommand};
use rustic_backend::BackendOptions;
use rustic_core::repofile::KeyId;
use rustic_core::{
    BackupOptions, ConfigOptions, Credentials, KeyOptions, LocalDestination, LsOptions, OpenStatus,
    PathList, Repository, RepositoryOptions, RestoreOptions, SnapshotOptions,
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

fn cmd_backup(
    repo: &str,
    sources: &[String],
    dry_run: bool,
    tag: Option<&str>,
    password_stdin: bool,
) -> Result<Value> {
    let password = read_password(password_stdin)?;

    let repo = open_repo(repo, &password)?.to_indexed_ids()?;

    let mut snap_opts = SnapshotOptions::default();
    if let Some(t) = tag {
        snap_opts = snap_opts.add_tags(t)?;
    }
    let snap = snap_opts.to_snapshot()?;

    let backup_opts = BackupOptions::default().dry_run(dry_run);
    let source: PathList = sources.iter().map(String::as_str).collect();

    let snap = repo.backup(&backup_opts, &source, snap)?;

    Ok(ok_data(json!({
        "snapshot_id": (*snap.id).to_hex().as_str().to_string(),
        "time": snap.time.to_string(),
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
                "time": s.time.to_string(),
                "paths": s.paths.iter().collect::<Vec<_>>(),
                "tags": s.tags.iter().collect::<Vec<_>>(),
                "hostname": s.hostname,
                "username": s.username,
            })
        })
        .collect();

    Ok(ok_data(json!(snap_list)))
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
        } => cmd_backup(&repo, &sources, dry_run, tag.as_deref(), cli.password_stdin),
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
    };

    match result {
        Ok(v) => println!("{v}"),
        Err(e) => {
            println!("{}", err(e.to_string()));
            std::process::exit(1);
        }
    }
}
