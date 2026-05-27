import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'pathe'

import type { CoreResult } from '#bekk-core'

/**
 * Resolves the path to the bekk-core debug binary.
 * Priority: BEKK_CORE_BIN env var → workspace debug build.
 * Returns null if the binary does not exist.
 */
export const resolveDebugBinary = (): string | null => {
    const envBin = process.env['BEKK_CORE_BIN']
    if (envBin && existsSync(envBin)) return envBin

    const ext = process.platform === 'win32' ? '.exe' : ''
    const debugPath = join(
        import.meta.dir,
        '..',
        '..',
        'bekk-core',
        'target',
        'debug',
        `bekk-core${ext}`,
    )
    return existsSync(debugPath) ? debugPath : null
}

/**
 * Prepends "local:" to Windows drive-letter paths, matching bekk-core's repo arg convention.
 */
export const toRepoArg = (p: string): string => (/^[A-Za-z]:/.test(p) ? `local:${p}` : p)

const readStreamText = (stream: ReadableStream<Uint8Array>): Promise<string> =>
    new Response(stream).text()

/**
 * Spawns bekk-core with --password-stdin and the given args.
 * Returns the parsed JSON result from stdout.
 */
export const runBekkCoreRaw = async (
    bin: string,
    args: string[],
    password: string,
    newPassword?: string,
): Promise<CoreResult> => {
    const proc = Bun.spawn([bin, '--password-stdin', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'pipe',
    })
    if (proc.stdin) {
        proc.stdin.write(password + '\n')
        if (newPassword) proc.stdin.write(newPassword + '\n')
        proc.stdin.end()
    }
    const stdoutPromise = readStreamText(proc.stdout)
    const stderrPromise = readStreamText(proc.stderr)

    await proc.exited
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (!stdout.trim()) {
        return { status: 'error', message: stderr.trim() || 'bekk-core returned no output' }
    }
    try {
        return JSON.parse(stdout.trim()) as CoreResult
    } catch {
        return { status: 'error', message: `bekk-core output is not valid JSON: ${stdout}` }
    }
}

export const runBekkCoreWithoutPassword = async (
    bin: string,
    args: string[],
): Promise<CoreResult> => {
    const proc = Bun.spawn([bin, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
    })
    const stdoutPromise = readStreamText(proc.stdout)
    const stderrPromise = readStreamText(proc.stderr)

    await proc.exited
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (!stdout.trim()) {
        return { status: 'error', message: stderr.trim() || 'bekk-core returned no output' }
    }
    try {
        return JSON.parse(stdout.trim()) as CoreResult
    } catch {
        return { status: 'error', message: `bekk-core output is not valid JSON: ${stdout}` }
    }
}

/**
 * Creates an isolated temporary directory for a test run.
 * Prefixed with "bekk-test-" for easy identification.
 */
export const createTestTempDir = (): string => {
    const dir = join(tmpdir(), `bekk-test-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    return dir
}

/**
 * Recursively removes a temporary directory created by createTestTempDir.
 */
export const cleanupTempDir = (path: string): void => {
    rmSync(path, { recursive: true, force: true })
}
