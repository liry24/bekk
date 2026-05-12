use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "bekk-core", about = "rustic-backed backup engine for bekk")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
    #[arg(long, help = "Read repository password from stdin")]
    pub password_stdin: bool,
}

#[derive(Subcommand)]
pub enum Commands {
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
