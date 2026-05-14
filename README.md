# Bekk

> [!IMPORTANT]
> This project is work in progress.<br/>
> Cross-platform builds are being performed, but it is currently tested only from Windows.<br/>
> The backend, rustic, is currently in beta and may contain bugs.

<div align="center">

![GitHub Stars](https://www.shieldcn.dev/github/stars/liry24/bekk.svg?variant=secondary&size=xs)
![Last commit](https://www.shieldcn.dev/github/last-commit/liry24/bekk.svg?variant=secondary&size=xs)
![Commits](https://www.shieldcn.dev/github/commits/liry24/bekk.svg?variant=secondary&size=xs)
![CI](https://www.shieldcn.dev/github/ci/liry24/bekk.svg?variant=secondary&size=xs)
![License](https://www.shieldcn.dev/github/license/liry24/bekk.svg?variant=secondary&size=xs)

</div>

## 🌱 About

This is a CLI application for easily managing PC backups.

It currently supports the following types of backups:

- Local data (deduplication, snapshots, encryption)
- List of installed applications
  - This feature is currently available only for Windows, and can list applications managed by winget and scoop.

Configurations and application lists can also be saved to external storage, with support for Gist and S3.

## 🚀 Getting Started

```sh
# With npm:
npm install -g bekk

# With Scoop (Windows):
scoop bucket add liry24 https://github.com/liry24/scoop-bucket
scoop install bekk
```

To set up your backup, run:

```sh
bekk init

# Just run the backup!
bekk backup
```

## 📖 Commands

### `bekk init`

Interactive setup wizard. Walks you through:

1. Choosing a backup destination (local folder or cloud storage via rclone)
2. Setting an encryption password (or auto-generating one)
3. Selecting source paths to back up
4. Optionally enabling sync backends (GitHub Gist or S3-compatible storage)

---

### `bekk backup`

Run a backup. Saves app lists (winget / scoop) and creates a new encrypted snapshot of all configured source paths in the repository. If a snapshot retention limit is configured, excess old snapshots are automatically removed after the backup succeeds.

| Flag        | Short | Description                                                      |
| ----------- | ----- | ---------------------------------------------------------------- |
| `--dry-run` | `-d`  | Dry run — scan apps and preview snapshot changes without writing |
| `--tag`     | `-t`  | Tag to attach to the snapshot                                    |

---

### `bekk apps`

Manage application lists and installations.

| Subcommand     | Description                     |
| -------------- | ------------------------------- |
| `apps list`    | List currently installed apps   |
| `apps backup`  | Save app lists to local storage |
| `apps restore` | Restore apps from backup        |

#### `apps list`

Lists applications managed by available package managers (currently winget and scoop on Windows).

#### `apps backup`

Backs up app lists from each available provider to the local data directory.

#### `apps restore`

Compares backed-up app lists against the current environment and lets you selectively install missing apps or update apps to the latest version.

| Flag        | Short | Description                                 |
| ----------- | ----- | ------------------------------------------- |
| `--dry-run` | `-d`  | Preview changes without installing anything |

> **Note:** App list backup/restore is currently only available on Windows.

---

### `bekk restore`

Restore files from a snapshot. If `--target` is omitted, you will be prompted to enter a destination path.

| Flag         | Short | Description                                |
| ------------ | ----- | ------------------------------------------ |
| `--snapshot` | `-s`  | Snapshot ID to restore (default: `latest`) |
| `--target`   | `-t`  | Destination path to restore files into     |
| `--dry-run`  | `-d`  | Dry run — preview what would be restored   |

See available snapshots with `bekk snapshots`.

---

### `bekk snapshots`

List all snapshots in the backup repository.

| Flag     | Short | Description                                  |
| -------- | ----- | -------------------------------------------- |
| `--json` |       | Output raw JSON instead of a formatted table |

---

### `bekk clean`

Run repository maintenance: prune orphaned data, check repository integrity, and repair the index.

| Flag               | Short | Description                                                              |
| ------------------ | ----- | ------------------------------------------------------------------------ |
| `--dry-run`        | `-d`  | Dry run — preview prune results without making changes                   |
| `--instant-delete` |       | Delete unreferenced pack files immediately (unsafe with parallel access) |

By default, `bekk clean` asks whether to enable instant-delete interactively. In dry-run mode, only the prune preview is shown and check/repair are skipped.

---

### `bekk schedule`

Manage the automated backup schedule.

| Subcommand     | Description                          |
| -------------- | ------------------------------------ |
| `schedule add` | Register a scheduled backup task     |
| `schedule rm`  | Remove the scheduled backup task     |
| `schedule`     | Show current schedule and usage help |

#### How it works

`schedule add` registers `bekk backup` directly with the OS native task scheduler. No daemon process stays resident.

| Flag         | Description                     | Example                |
| ------------ | ------------------------------- | ---------------------- |
| `--daily`    | Run every day at HH:MM          | `--daily 02:00`        |
| `--weekly`   | Run every week on DOW at HH:MM  | `--weekly "sun 03:00"` |
| `--monthly`  | Run every month on DAY at HH:MM | `--monthly "1 04:00"`  |
| `--interval` | Run every N minutes             | `--interval 30`        |

Platform support:

| Platform | Scheduler mechanism                 |
| -------- | ----------------------------------- |
| Windows  | Task Scheduler (`schtasks`)         |
| macOS    | `launchd` (`StartCalendarInterval`) |
| Linux    | `systemd` timer                     |

---

---

### `bekk config`

Interactive configuration menu. Run `bekk config` to open the menu.

| Option             | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| Backup destination | Set or change the backup repo path                         |
| Source paths       | Add or remove folders to back up                           |
| Password           | Change the backup password; optionally save to config file |
| Sync backends ▶    | Configure Gist and S3 destinations for `bekk push`         |
| Advanced ▶         | App list, compression, pack size, chunk size, verify       |

#### Advanced settings:

| Setting      | Description                                         | Default         |
| ------------ | --------------------------------------------------- | --------------- |
| App list     | Winget sources to include in app list backup        | winget, msstore |
| Compression  | zstd compression level (0=none, -7 ultrafast, 1–22) | 1               |
| Pack size    | Size of data packs stored in the repo (MiB)         | 32 MiB          |
| Chunk size   | Average chunk size for deduplication (MiB)          | 1 MiB           |
| Extra verify | Re-decrypt/decompress each pack before upload       | Enabled         |

> **Note:** The interactive `config` menu offers preset compression levels. You can set any value between `-7` and `22` by editing the config file directly.

`bekk config show` prints all current settings without entering the menu.

`bekk config open` opens the config directory in your file explorer.

#### Password storage

By default, the backup password is stored in the OS credential manager (Windows Credential Manager / macOS Keychain / libsecret).

During `bekk init` or via `bekk config` → Password, you can optionally save the password to the config file as well. This allows automated/scripted use without the OS keychain, but comes with important caveats:

> **⚠ Warning:** The password stored in the config file is included as **plaintext** when you run `bekk push` or `bekk pull`. If you sync to GitHub Gist or S3, anyone with access to that Gist or bucket can read your backup password. Only enable this if you trust the security of your sync destination.

---

### `bekk push` / `bekk pull`

Sync your config and app lists to/from external storage backends (GitHub Gist, S3-compatible).

**What is synced:**

- Config file (all settings, including `savedPassword` if set — see warning below)
- App lists (winget, scoop)

**`bekk push`** — saves current app lists, then uploads to all enabled backends.

| Flag        | Short | Description                                                 |
| ----------- | ----- | ----------------------------------------------------------- |
| `--backend` | `-b`  | Push to a specific backend by name (e.g. `gist`, `work-r2`) |

**`bekk pull`** — downloads config and app lists from a backend and writes them locally. If multiple backends are enabled and `--backend` is not specified, you will be prompted to choose one.

| Flag        | Short | Description                                                   |
| ----------- | ----- | ------------------------------------------------------------- |
| `--backend` | `-b`  | Pull from a specific backend by name (e.g. `gist`, `work-r2`) |
| `--from`    | `-f`  | Identifier override (Gist ID/URL or S3 object key)            |

To enable a backend, run `bekk gist login` (for Gist) or configure an S3 destination via `bekk config`.

---

### `bekk gist`

Manage GitHub Gist sync.

| Subcommand    | Description                              |
| ------------- | ---------------------------------------- |
| `gist login`  | Authenticate with GitHub via Device Flow |
| `gist logout` | Logout from GitHub Gist                  |

## 🛠️ Stack

- [Rustic][rustic]: Backup engine (Rust)
- [Crust][crust]: Cross-platform CLI framework
- [Bun][bun]: JavaScript runtime

## ⚖️ License

MIT

[bun]: https://bun.sh
[crust]: https://crustjs.com
[rustic]: https://rustic.cli.rs/
