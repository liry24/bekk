use std::env;

use anyhow::{Result, anyhow};
use bytesize::ByteSize;
use clap::{Parser, Subcommand};
use rustic_backend::BackendOptions;
use rustic_core::{
    BackupOptions, ConfigOptions, Credentials, KeyOptions, LocalDestination, LsOptions, PathList,
    Repository, RepositoryOptions, RestoreOptions, SnapshotOptions,
};
use serde_json::{Value, json};

// ─── CLI ─────────────────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(name = "bekk-core", about = "rustic-backed backup engine for bekk")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new backup repository
    Init {
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

fn read_password() -> Result<String> {
    env::var("BEKK_REPO_PASSWORD")
        .map_err(|_| anyhow!("BEKK_REPO_PASSWORD environment variable is not set"))
}

fn make_backends(repo: &str) -> Result<rustic_core::RepositoryBackends> {
    let backends = BackendOptions::default().repository(repo).to_backends()?;
    Ok(backends)
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
    compression: i32,
    no_extra_verify: bool,
    pack_size: u64,
    chunk_size: u64,
) -> Result<Value> {
    let password = read_password()?;
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    let key_opts = KeyOptions::default();
    let config_opts = build_config_opts(compression, no_extra_verify, pack_size, chunk_size);

    Repository::new(&repo_opts, &backends)?.init(&credentials, &key_opts, &config_opts)?;

    Ok(json!({ "status": "ok" }))
}

fn cmd_apply_config(
    repo: &str,
    compression: i32,
    no_extra_verify: bool,
    pack_size: u64,
    chunk_size: u64,
) -> Result<Value> {
    let password = read_password()?;
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    let config_opts = build_config_opts(compression, no_extra_verify, pack_size, chunk_size);

    let mut repo = Repository::new(&repo_opts, &backends)?.open(&credentials)?;
    repo.apply_config(&config_opts)?;

    Ok(json!({ "status": "ok" }))
}

fn cmd_backup(repo: &str, sources: &[String], dry_run: bool, tag: Option<&str>) -> Result<Value> {
    let password = read_password()?;
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);

    let repo = Repository::new(&repo_opts, &backends)?
        .open(&credentials)?
        .to_indexed_ids()?;

    let mut snap_opts = SnapshotOptions::default();
    if let Some(t) = tag {
        snap_opts = snap_opts.add_tags(t)?;
    }
    let snap = snap_opts.to_snapshot()?;

    let backup_opts = BackupOptions::default().dry_run(dry_run);
    let source: PathList = sources.iter().map(String::as_str).collect();

    let snap = repo.backup(&backup_opts, &source, snap)?;

    Ok(json!({
        "status": "ok",
        "data": {
            "snapshot_id": (*snap.id).to_hex().as_str().to_string(),
            "time": snap.time.to_string(),
            "paths": snap.paths.iter().collect::<Vec<_>>(),
        }
    }))
}

fn cmd_restore(repo: &str, snapshot: &str, target: &str, dry_run: bool) -> Result<Value> {
    let password = read_password()?;
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);

    let repo = Repository::new(&repo_opts, &backends)?
        .open(&credentials)?
        .to_indexed()?;

    let node = repo.node_from_snapshot_path(snapshot, |_| true)?;
    let dest = LocalDestination::new(target, true, !node.is_dir())?;
    let ls_opts = LsOptions::default();
    let restore_opts = RestoreOptions::default();

    let plan = {
        let node_streamer = repo.ls(&node, &ls_opts)?;
        repo.prepare_restore(&restore_opts, node_streamer, &dest, dry_run)?
    };

    if !dry_run {
        let node_streamer = repo.ls(&node, &ls_opts)?;
        repo.restore(plan, &restore_opts, node_streamer, &dest)?;
    }

    Ok(json!({ "status": "ok" }))
}

fn cmd_snapshots(repo: &str) -> Result<Value> {
    let password = read_password()?;
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);

    let repo = Repository::new(&repo_opts, &backends)?.open(&credentials)?;
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

    Ok(json!({
        "status": "ok",
        "data": snap_list
    }))
}

// ─── Entry point ─────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init {
            repo,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
        } => cmd_init(&repo, compression, no_extra_verify, pack_size, chunk_size),
        Commands::Backup {
            repo,
            sources,
            dry_run,
            tag,
        } => cmd_backup(&repo, &sources, dry_run, tag.as_deref()),
        Commands::Restore {
            repo,
            snapshot,
            target,
            dry_run,
        } => cmd_restore(&repo, &snapshot, &target, dry_run),
        Commands::Snapshots { repo } => cmd_snapshots(&repo),
        Commands::ApplyConfig {
            repo,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
        } => cmd_apply_config(&repo, compression, no_extra_verify, pack_size, chunk_size),
    };

    match result {
        Ok(v) => println!("{v}"),
        Err(e) => {
            let output = json!({ "status": "error", "message": e.to_string() });
            println!("{output}");
            std::process::exit(1);
        }
    }
}
