import { join, dirname, normalize } from 'pathe'

const bekkCoreBin = () => {
    const ext = process.platform === 'win32' ? '.exe' : ''
    const name = `bekk-core${ext}`

    // In a compiled Bun standalone binary, process.execPath is the bekk binary itself.
    // bekk-core is expected in the same directory.
    // In development (bun run src/cli.ts), fall back to the project-local build output.
    const exeDir = dirname(process.execPath)
    const bundledPath = join(exeDir, name)

    // Dev fallback: bekk-core/target/debug/bekk-core(.exe)
    if (/bun(\.exe)?$/i.test(process.execPath))
        return join(import.meta.dir, '..', '..', 'bekk-core', 'target', 'debug', name)

    return bundledPath
}

const toRepoArg = (p: string) => (/^[A-Za-z]:/.test(p) ? `local:${p}` : p)

// ─── Response types ───────────────────────────────────────────────────────────

export type CoreResult<T = unknown> =
    | { status: 'ok'; data: T }
    | { status: 'ok' }
    | { status: 'error'; message: string }

export interface BackupData {
    snapshot_id: string
    time: string
    paths: string[]
}

export interface SnapshotEntry {
    id: string
    time: string
    paths: string[]
    tags: string[]
    hostname: string
    username: string
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const runBekkCore = async (
    args: string[],
    password?: string,
    newPassword?: string,
): Promise<CoreResult> => {
    const bin = bekkCoreBin()
    const hasStdinPassword = password !== undefined
    const proc = Bun.spawn([bin, ...(hasStdinPassword ? ['--password-stdin'] : []), ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: hasStdinPassword ? 'pipe' : 'inherit',
    })
    if (hasStdinPassword && proc.stdin) {
        proc.stdin.write(password + '\n')
        if (newPassword) proc.stdin.write(newPassword + '\n')
        proc.stdin.end()
    }
    await proc.exited
    const stdout = await new Response(proc.stdout).text()
    if (!stdout.trim()) {
        const stderr = await new Response(proc.stderr).text()
        return { status: 'error', message: stderr.trim() || 'bekk-core returned no output' }
    }
    try {
        return JSON.parse(stdout) as CoreResult
    } catch {
        return { status: 'error', message: `bekk-core output is not valid JSON: ${stdout}` }
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PerfOpts {
    compression?: number
    extraVerify?: boolean
    packSizeMib?: number
    chunkSizeMib?: number
}

export interface InitOpts extends PerfOpts {
    forceReinit?: boolean
}

export interface InitConfigPayload {
    sourcePaths: string[]
    repoPath: string
    gistId: string
    gistEnabled: boolean
    s3DestinationsJson: string
    wingetIncludeSources: string[]
    cronSchedule: string
    compression: number
    extraVerify: boolean
    packSizeMib: number
    chunkSizeMib: number
    savedPassword: string
}

export interface InitializeRepositoryOpts {
    repoPath: string
    password: string
    forceReinit?: boolean
}

export interface InitializeRepositoryResult {
    normalizedRepo: string
    nextConfig: InitConfigPayload
    initResult: CoreResult
}

const buildInitConfig = (normalizedRepo: string): InitConfigPayload => ({
    sourcePaths: [],
    repoPath: normalizedRepo,
    gistId: '',
    gistEnabled: false,
    s3DestinationsJson: '[]',
    wingetIncludeSources: ['winget', 'msstore'],
    cronSchedule: '',
    compression: 1,
    extraVerify: true,
    packSizeMib: 32,
    chunkSizeMib: 1,
    savedPassword: '',
})

export const bekkCore = {
    init(repo: string, password: string, opts: InitOpts = {}): Promise<CoreResult> {
        const {
            compression = 1,
            extraVerify = true,
            packSizeMib = 32,
            chunkSizeMib = 1,
            forceReinit = false,
        } = opts
        const args = [
            'init',
            '--repo',
            toRepoArg(repo),
            '--compression',
            String(compression),
            '--pack-size',
            String(packSizeMib),
            '--chunk-size',
            String(chunkSizeMib),
        ]
        if (!extraVerify) args.push('--no-extra-verify')
        if (forceReinit) args.push('--force-reinit')
        return runBekkCore(args, password)
    },

    async initializeRepository(
        opts: InitializeRepositoryOpts,
    ): Promise<InitializeRepositoryResult> {
        const { repoPath, password, forceReinit = false } = opts
        const nextConfig = buildInitConfig(normalize(repoPath))
        const initResult = await this.init(normalize(repoPath), password, {
            compression: nextConfig.compression,
            extraVerify: nextConfig.extraVerify,
            packSizeMib: nextConfig.packSizeMib,
            chunkSizeMib: nextConfig.chunkSizeMib,
            forceReinit,
        })
        return { normalizedRepo: normalize(repoPath), nextConfig, initResult }
    },

    backup(repo: string, password: string, sources: string[], dryRun = false, tag?: string) {
        const args = [
            'backup',
            '--repo',
            toRepoArg(repo),
            ...sources.flatMap((s) => ['--source', s]),
        ]
        if (dryRun) args.push('--dry-run')
        if (tag) args.push('--tag', tag)
        return runBekkCore(args, password) as Promise<CoreResult<BackupData>>
    },

    restore(repo: string, password: string, target: string, snapshot = 'latest', dryRun = false) {
        const args = [
            'restore',
            '--repo',
            toRepoArg(repo),
            '--snapshot',
            snapshot,
            '--target',
            target,
        ]
        if (dryRun) args.push('--dry-run')
        return runBekkCore(args, password)
    },

    snapshots(repo: string, password: string) {
        return runBekkCore(['snapshots', '--repo', toRepoArg(repo)], password) as Promise<
            CoreResult<SnapshotEntry[]>
        >
    },

    applyConfig(repo: string, password: string, perf: PerfOpts = {}) {
        const { compression = 1, extraVerify = true, packSizeMib = 32, chunkSizeMib = 1 } = perf
        const args = [
            'apply-config',
            '--repo',
            toRepoArg(repo),
            '--compression',
            String(compression),
            '--pack-size',
            String(packSizeMib),
            '--chunk-size',
            String(chunkSizeMib),
        ]
        if (!extraVerify) args.push('--no-extra-verify')
        return runBekkCore(args, password)
    },

    changePassword(repo: string, oldPassword: string, newPassword: string) {
        return runBekkCore(['change-password', '--repo', toRepoArg(repo)], oldPassword, newPassword)
    },
}
