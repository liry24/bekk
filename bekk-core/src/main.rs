use clap::Parser;

mod cli;
mod commands;
mod progress;
mod response;
mod schedule;

use cli::{Cli, Commands};

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
        } => commands::cmd_init(
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
        } => commands::cmd_backup(&repo, &sources, dry_run, tag.as_deref(), cli.password_stdin, progress, snapshot_limit),
        Commands::Restore {
            repo,
            snapshot,
            target,
            dry_run,
        } => commands::cmd_restore(&repo, &snapshot, &target, dry_run, cli.password_stdin),
        Commands::Snapshots { repo } => commands::cmd_snapshots(&repo, cli.password_stdin),
        Commands::ChangePassword { repo } => commands::cmd_change_password(&repo, cli.password_stdin),
        Commands::ApplyConfig {
            repo,
            compression,
            no_extra_verify,
            pack_size,
            chunk_size,
        } => commands::cmd_apply_config(
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
        } => commands::cmd_clean(&repo, dry_run, instant_delete, cli.password_stdin),
        Commands::ScheduleInfo {
            daily,
            weekly,
            monthly,
            interval,
        } => schedule::cmd_schedule_info(daily, weekly, monthly, interval),
    };

    match result {
        Ok(v) => println!("{v}"),
        Err(e) => {
            println!("{}", response::err(e.to_string()));
            std::process::exit(1);
        }
    }
}
