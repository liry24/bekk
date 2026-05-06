# Bekk CLI

A Windows backup CLI. Backs up local folders via Robocopy and exports installed app lists (winget / Scoop).
Config can be synced to a GitHub Gist.

## Installation

```sh
# With npm:
npm install -g bekk

# With Scoop:
scoop bucket add liry24 https://github.com/liry24/scoop-bucket
scoop install bekk
```

## Quick start

```sh
bekk init  # Set backup destination and create config
bekk config add "C:\Users\you\Documents"
bekk backup
```

## Commands

### `bekk init`

Interactive setup. Sets the backup destination and creates a default config file.

---

### `bekk backup`

Runs a full backup — copies source folders to the destination with Robocopy, then exports your installed app lists (winget, Scoop).

| Flag                | Short | Description                                                   |
| ------------------- | ----- | ------------------------------------------------------------- |
| `--no-mirror`       |       | Disable mirror mode (don't delete extra files at destination) |
| `--retry-count <n>` | `-r`  | Override retry count on file copy error                       |
| `--retry-wait <n>`  | `-w`  | Override retry wait (seconds)                                 |
| `--threads <n>`     | `-t`  | Override thread count                                         |
| `--dry-run`         | `-d`  | Preview changes without writing anything                      |
| `--log <path>`      |       | Custom log file path                                          |

If you're authenticated (`bekk login`), you'll be prompted to push updated config/app lists to Gist after the backup.

---

### `bekk config`

Manage configuration.

| Subcommand           | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `config show`        | Print current settings                                    |
| `config add <path>`  | Add a source folder to back up                            |
| `config remove`      | Interactively remove a source folder                      |
| `config dest <path>` | Change the backup destination                             |
| `config data`        | Tune Robocopy options (mirror, retries, junctions)        |
| `config apps`        | Choose which winget sources to include in app list backup |

---

### `bekk login / bekk logout`

Authenticate with GitHub via Device Flow. Required to use Gist sync.

---

### `bekk gist`

Sync your config and app lists to a private GitHub Gist.

| Subcommand              | Description               |
| ----------------------- | ------------------------- |
| `gist push`             | Upload config to Gist     |
| `gist pull [id-or-url]` | Download config from Gist |

---

### `bekk schedule`

Register or remove a Windows Task Scheduler task that runs `bekk backup` automatically. Run as administrator to register the task as SYSTEM (no login required).

| Subcommand            | Description                                        |
| --------------------- | -------------------------------------------------- |
| `schedule register`   | Register backup task (daily / weekly / at startup) |
| `schedule unregister` | Remove a registered task                           |

## License

MIT
