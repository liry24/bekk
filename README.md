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

Interactive setup. Sets the backup destination and creates a default config file.

---

### `bekk backup`

Run a backup. Saves app lists (winget / scoop) and creates a new encrypted snapshot of all configured source paths in the repository.

| Flag       | Short | Description                                                      |
| ---------- | ----- | ---------------------------------------------------------------- |
| `--dryRun` | `-d`  | Dry run — scan apps and preview snapshot changes without writing |
| `--tag`    | `-t`  | Tag to attach to the snapshot                                    |

---

### `bekk restore`

Restore files from a snapshot. If `--target` is omitted, you will be prompted to enter a destination path.

| Flag         | Short | Description                                |
| ------------ | ----- | ------------------------------------------ |
| `--snapshot` | `-s`  | Snapshot ID to restore (default: `latest`) |
| `--target`   | `-t`  | Destination path to restore files into     |
| `--dryRun`   | `-d`  | Dry run — preview what would be restored   |

See available snapshots with `bekk snapshots`.

---

### `bekk schedule`

Manage the automated backup schedule.

| Subcommand            | Description                                     |
| --------------------- | ----------------------------------------------- |
| `schedule register`   | Register the backup daemon as a startup service |
| `schedule unregister` | Remove the registered startup service           |
| `schedule status`     | Show the current schedule and next run time     |

#### How it works

`schedule register` does two things:

1. Prompts for a **cron expression** (e.g. `0 2 * * *` for daily at 02:00 UTC) and saves it to config
2. Registers `bekk daemon` as an OS-level startup service so it runs automatically on boot

Platform support:

| Platform | Admin mode              | User mode                     |
| -------- | ----------------------- | ----------------------------- |
| Windows  | Task Scheduler (SYSTEM) | Task Scheduler (current user) |
| macOS    | LaunchDaemon            | LaunchAgent                   |
| Linux    | systemd system unit     | systemd user unit             |

Run as admin/root to register a system-wide service; otherwise it registers for the current user only.

---

### `bekk config`

Interactive configuration menu. Run `bekk config` to open the menu.

| Option             | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| Backup destination | Set or change the backup repo path                         |
| Source paths       | Add or remove folders to back up                           |
| Password           | Change the backup password; optionally save to config file |
| Advanced ▶         | App list, compression, pack size, chunk size, verify       |

#### Advanced settings:

| Setting      | Description                                         | Default         |
| ------------ | --------------------------------------------------- | --------------- |
| App list     | Winget sources to include in app list backup        | winget, msstore |
| Compression  | zstd compression level (0=none, -7 ultrafast, 1–22) | 1               |
| Pack size    | Size of data packs stored in the repo (MiB)         | 32 MiB          |
| Chunk size   | Average chunk size for deduplication (MiB)          | 1 MiB           |
| Extra verify | Re-decrypt/decompress each pack before upload       | Enabled         |

`bekk config show` prints all current settings without entering the menu.

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

| Flag        | Short | Description                                      |
| ----------- | ----- | ------------------------------------------------ |
| `--backend` | `-b`  | Push to a specific backend by name (e.g. `gist`) |

**`bekk pull`** — downloads config and app lists from a backend and writes them locally. If multiple backends are enabled and `--backend` is not specified, you will be prompted to choose one.

| Flag        | Short | Description                                        |
| ----------- | ----- | -------------------------------------------------- |
| `--backend` | `-b`  | Pull from a specific backend by name (e.g. `gist`) |
| `--from`    | `-f`  | Identifier override (Gist ID/URL or S3 object key) |

To enable a backend, run `bekk gist login` (for Gist) or configure an S3 destination via `bekk config`.

---

### `bekk gist`

Manage GitHub Gist sync.

| Subcommand    | Description                              |
| ------------- | ---------------------------------------- |
| `gist login`  | Authenticate with GitHub via Device Flow |
| `gist logout` | Logout from GitHub Gist                  |

## 🛠️ Stack

- rustic: Backup engine (Rust)
- Crust: Cross-platform CLI framework
- Bun: JavaScript runtime

## ⚖️ License

MIT
