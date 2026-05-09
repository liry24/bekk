# Agent Instructions for bekk

## Runtime & Package Manager

- **Bun 1.3.13** is the only supported runtime. Use `bun` for all JS/TS commands.
- `packageManager` is pinned to `bun@1.3.13`. Do not use npm, pnpm, or yarn.
- Install: `bun install --frozen-lockfile`

## Architecture

Hybrid CLI: TypeScript frontend (`src/`) + Rust backend (`bekk-core/`).

- **TS entry**: `src/cli.ts` — wires Crust commands.
- **Rust entry**: `bekk-core/src/main.rs` — wraps `rustic_core` backup engine.
- **Communication**: TS spawns `bekk-core` binary and passes password via **stdin** (`--password-stdin`). Never use `BEKK_REPO_PASSWORD` env var (removed).
- **Path aliases** (defined in `tsconfig.json`):
  - `#lib/*` → `src/lib/*`
  - `#bekk-core` → `bekk-core/src`

### Layer boundaries

- **`bekk-core` is a pure processing layer**. It must never contain CLI display concerns (colors, progress bars, spinner frames, or console output). Keep all terminal formatting, user-facing messages, and interactive UI inside `src/`.

## Developer Commands

```bash
# Dev run
bun run dev                    # bun run src/cli.ts

# Verification (run in this order)
bun run fmt:check              # oxfmt check
bun run lint                   # oxlint
bun run check:types            # tsc --noEmit
bun run cargo:check            # cargo check --manifest-path bekk-core/Cargo.toml

# Build
bun run build:core             # cargo build --manifest-path bekk-core/Cargo.toml
bun run build                  # crust build (packages JS CLI)
bun run build:all              # build:core + build
```

## Code Style

- **Formatter**: `oxfmt` (not Prettier). Config in `oxfmt.config.ts`:
  - tabWidth: 4, semi: false, singleQuote: true, printWidth: 100
  - YAML/Markdown use tabWidth: 2
- **Linter**: `oxlint`. Config in `oxlint.config.ts` (import plugin only).
- **TypeScript**: strict mode, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`.
- Import style: `import { foo } from 'bar'` (type imports must use `import type`).

## Rust Backend (`bekk-core/`)

- Rust edition: **2024**, minimum version: **1.88.0**
- Binary name: `bekk-core` (`.exe` on Windows)
- Dev build path: `bekk-core/target/debug/bekk-core`
- Release build path: `bekk-core/target/release/bekk-core`

### Supported commands

The backend exposes these operations via JSON-RPC over stdin/stdout:

- `initialize_repository` — Create or reinitialize a backup repository
- `backup` — Create a snapshot; prune excess snapshots **after** success if a retention limit is configured
- `restore` — Restore files from a snapshot
- `snapshots` — List snapshots
- `clean` — Prune orphaned data, check repository integrity, and repair index

### Prune timing

Snapshot pruning triggered by the retention limit runs **after** `backup()` succeeds. It does not run if the backup fails or is cancelled.

## Version Bumping

Use `bumpp` (config: `bump.config.ts`). Bumping updates **both** `package.json` and `bekk-core/Cargo.toml`, then runs `cargo update` for the Rust workspace.

## CI

`.github/workflows/build.yml` runs on PRs to `main`:

1. `cargo check` (Rust)
2. `bun install --frozen-lockfile`
3. `bun run fmt:check`
4. `bun run lint`
5. `bun run check:types`
6. `bun run build`

## Crust CLI Framework

Commands live in `src/commands/*.ts`. Each exports a command built with `app.sub('name')` and registered in `src/cli.ts`.

- Use `@crustjs/prompts` for interactive prompts.
- Use `@crustjs/style` for colors/formatting.
- Use `@crustjs/progress` for spinners.
- CLI logging utility: `src/lib/log.ts` (`cliLog()`) — project-specific helper for multi-line output blocks (not part of Crust).

## UI Components

- `src/lib/ui/task-list.ts` (`createTaskList`) is a **live-updating** task list that uses ANSI cursor control to redraw lines in place. Do not confuse it with `@crustjs/style`'s static `taskList()` formatter, which is only for one-shot string output.

## Testing

No test suite exists currently. Do not add tests unless explicitly requested.

## Important Constraints

- **Windows-first**: Primary testing is on Windows. Cross-platform builds exist but are less verified.
- **Password handling**: Password is passed to `bekk-core` via stdin (`--password-stdin` flag). The old `BEKK_REPO_PASSWORD` env var mechanism was removed.
- **Config store**: Uses `@crustjs/store` with Zod validation. Config dir is OS-specific (`configDir('bekk')`).
- **Do not commit**: Never run `git commit` unless explicitly asked. Never push to remote unless explicitly asked.
- **Dry-run testing**: After implementing CLI output changes (e.g. progress bars, spinners, task lists), always run `bun run dev backup --dry-run` to verify terminal rendering. Do not skip this step when a dry-run-capable command exists for the modified feature.

## Documentation Maintenance

When you make changes that affect user-facing behavior, architecture, or development conventions:

1. Update `README.md` to reflect new commands, flags, workflows, or usage examples.
2. Update `AGENTS.md` if the change affects architecture, constraints, or agent-critical context.
3. **Notify the user** in your response of exactly which documentation updates were made and why.
