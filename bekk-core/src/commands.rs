use std::{fs, io::ErrorKind};

use anyhow::{Result, anyhow};
use bytesize::ByteSize;
use rustic_backend::BackendOptions;
use rustic_core::repofile::KeyId;
use rustic_core::{
    BackupOptions, CheckOptions, ConfigOptions, Credentials, KeyOptions, LocalDestination,
    LsOptions, OpenStatus, PathList, PruneOptions, PrunePlan, Repository, RepositoryOptions,
    RepairIndexOptions, RestoreOptions, SnapshotOptions,
};
use serde_json::{Value, json};

use crate::progress::JsonProgressBars;
use crate::response::{ok, ok_data};

pub fn read_password(stdin: bool) -> Result<String> {
    if !stdin {
        return Err(anyhow!(
            "Password must be provided via stdin (use --password-stdin)"
        ));
    }
    let mut password = String::new();
    std::io::stdin().read_line(&mut password)?;
    Ok(password.trim_end_matches('\n').trim_end_matches('\r').to_string())
}

pub fn make_backends(repo: &str) -> Result<rustic_core::RepositoryBackends> {
    let backends = BackendOptions::default().repository(repo).to_backends()?;
    Ok(backends)
}

pub fn open_repo(repo: &str, password: &str) -> Result<Repository<OpenStatus>> {
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    Ok(Repository::new(&repo_opts, &backends)?.open(&credentials)?)
}

pub fn open_repo_with_progress(repo: &str, password: &str, pb: impl rustic_core::ProgressBars) -> Result<Repository<OpenStatus>> {
    let backends = make_backends(repo)?;
    let repo_opts = RepositoryOptions::default();
    let credentials = Credentials::password(password);
    Ok(Repository::new_with_progress(&repo_opts, &backends, pb)?.open(&credentials)?)
}

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

pub fn cmd_init(
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

pub fn cmd_change_password(repo: &str, password_stdin: bool) -> Result<Value> {
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

pub fn cmd_apply_config(
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

pub fn cmd_clean(repo: &str, dry_run: bool, instant_delete: bool, password_stdin: bool) -> Result<Value> {
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

pub fn cmd_backup(
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

pub fn cmd_restore(
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

pub fn cmd_snapshots(repo: &str, password_stdin: bool) -> Result<Value> {
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
