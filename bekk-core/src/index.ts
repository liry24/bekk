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

const streamLines = async (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
            if (line.trim()) onLine(line)
        }
    }
    if (buffer.trim()) onLine(buffer)
}

interface BekkCoreProc {
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    stdin?: WritableStream
    exited: Promise<number>
}

const readStreamText = (stream: ReadableStream<Uint8Array>): Promise<string> =>
    new Response(stream).text()

const execBekkCore = (
    args: string[],
    password?: string,
    newPassword?: string,
): { proc: BekkCoreProc; hasStdinPassword: boolean } => {
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
    return { proc: proc as unknown as BekkCoreProc, hasStdinPassword }
}

const parseCoreResult = async (proc: BekkCoreProc): Promise<CoreResult> => {
    const stdoutPromise = readStreamText(proc.stdout)
    const stderrPromise = readStreamText(proc.stderr)

    await proc.exited
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (!stdout.trim()) {
        return { status: 'error', message: stderr.trim() || 'bekk-core returned no output' }
    }
    try {
        return JSON.parse(stdout) as CoreResult
    } catch {
        return { status: 'error', message: `bekk-core output is not valid JSON: ${stdout}` }
    }
}

const runBekkCore = async (
    args: string[],
    password?: string,
    newPassword?: string,
): Promise<CoreResult> => {
    const { proc } = execBekkCore(args, password, newPassword)
    return parseCoreResult(proc)
}

export interface ProgressEvent {
    type: 'progress'
    phase: string
    action: string
    progress_type?: 'spinner' | 'counter' | 'bytes'
    length?: number
    title?: string
    increment?: number
}

export interface BackupStreamCallbacks {
    onProgress?: (event: ProgressEvent) => void
}

const runBekkCoreStream = async (
    args: string[],
    callbacks: BackupStreamCallbacks,
    password?: string,
    newPassword?: string,
): Promise<CoreResult> => {
    const { proc } = execBekkCore(args, password, newPassword)
    const stderrPromise = readStreamText(proc.stderr)

    let result: CoreResult | null = null
    const pendingLines: string[] = []

    await streamLines(proc.stdout, (line) => {
        try {
            const parsed = JSON.parse(line) as Record<string, unknown>
            if (parsed.type === 'progress') {
                callbacks.onProgress?.(parsed as unknown as ProgressEvent)
                return
            }
            if (parsed.status === 'ok' || parsed.status === 'error') {
                result = parsed as CoreResult
                return
            }
        } catch {
            // not JSON, treat as raw line
        }
        pendingLines.push(line)
    })

    await proc.exited
    const stderr = await stderrPromise

    if (result) return result

    const stdout = pendingLines.join('\n')
    if (!stdout.trim()) {
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
    scheduleConfigJson: string
    compression: number
    extraVerify: boolean
    packSizeMib: number
    chunkSizeMib: number
    snapshotLimit: number
    savedPassword: string
    providerConfigsJson: string
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
    scheduleConfigJson: '[]',
    compression: 1,
    extraVerify: true,
    packSizeMib: 32,
    chunkSizeMib: 1,
    snapshotLimit: 1,
    savedPassword: '',
    providerConfigsJson: '{}',
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

    backup(
        repo: string,
        password: string,
        sources: string[],
        dryRun = false,
        tag?: string,
        snapshotLimit?: number,
    ) {
        const args = [
            'backup',
            '--repo',
            toRepoArg(repo),
            ...sources.flatMap((s) => ['--source', s]),
        ]
        if (dryRun) args.push('--dry-run')
        if (tag) args.push('--tag', tag)
        if (snapshotLimit !== undefined) args.push('--snapshot-limit', String(snapshotLimit))
        return runBekkCore(args, password) as Promise<CoreResult<BackupData>>
    },

    backupStream(
        repo: string,
        password: string,
        sources: string[],
        callbacks: BackupStreamCallbacks,
        dryRun = false,
        tag?: string,
        snapshotLimit?: number,
    ) {
        const args = [
            'backup',
            '--repo',
            toRepoArg(repo),
            '--progress',
            ...sources.flatMap((s) => ['--source', s]),
        ]
        if (dryRun) args.push('--dry-run')
        if (tag) args.push('--tag', tag)
        if (snapshotLimit !== undefined) args.push('--snapshot-limit', String(snapshotLimit))
        return runBekkCoreStream(args, callbacks, password) as Promise<CoreResult<BackupData>>
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

    clean(repo: string, password: string, dryRun = false, instantDelete = false) {
        const args = ['clean', '--repo', toRepoArg(repo)]
        if (dryRun) args.push('--dry-run')
        if (instantDelete) args.push('--instant-delete')
        return runBekkCore(args, password) as Promise<
            CoreResult<{
                prune: {
                    ok?: boolean
                    unreferenced_packs?: number
                    unreferenced_size?: number
                }
                check: { ok?: boolean; errors?: { level: string; message: string }[] } | null
                repair_index: { ok?: boolean } | null
            }>
        >
    },

    scheduleInfo(opts: {
        daily?: string
        weekly?: [string, string]
        monthly?: [string, string]
        interval?: number
    }) {
        const args = ['schedule-info']
        if (opts.daily) {
            args.push('--daily', opts.daily)
        } else if (opts.weekly) {
            args.push('--weekly', opts.weekly[0], opts.weekly[1])
        } else if (opts.monthly) {
            args.push('--monthly', opts.monthly[0], opts.monthly[1])
        } else if (opts.interval !== undefined) {
            args.push('--interval', String(opts.interval))
        }
        return runBekkCore(args) as Promise<CoreResult<{ next_run: string }>>
    },
}
