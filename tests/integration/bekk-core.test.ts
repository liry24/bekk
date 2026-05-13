import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

import { join } from 'pathe'

import type { BackupData, SnapshotEntry } from '#bekk-core'

import {
    cleanupTempDir,
    createTestTempDir,
    resolveDebugBinary,
    runBekkCoreRaw,
    toRepoArg,
} from '../helpers/bekk-core-runner'

const binary = resolveDebugBinary()
if (!binary)
    console.warn(
        '[bekk-core tests] Binary not found — tests will be skipped.\n' +
            '  Run `bun run build:core` to build the binary and enable these tests.',
    )

/** Recursively searches for a file by name under a directory. */
const findFile = (dir: string, name: string): string | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            const found = findFile(join(dir, entry.name), name)
            if (found) return found
        } else if (entry.name === name) {
            return join(dir, entry.name)
        }
    }
    return null
}

describe('bekk-core lifecycle', () => {
    const password = 'test-password-bekk'

    let tempBase = ''
    let repoPath = ''
    let sourcePath = ''
    let restorePath = ''
    let snapshotId = ''

    beforeAll(() => {
        if (!binary) return

        tempBase = createTestTempDir()
        repoPath = join(tempBase, 'repo')
        sourcePath = join(tempBase, 'source')
        restorePath = join(tempBase, 'restore')

        mkdirSync(repoPath, { recursive: true })
        mkdirSync(join(sourcePath, 'subdir'), { recursive: true })
        mkdirSync(restorePath, { recursive: true })

        writeFileSync(join(sourcePath, 'hello.txt'), 'hello world')
        writeFileSync(join(sourcePath, 'subdir', 'world.txt'), 'nested file')
    })

    afterAll(() => {
        if (tempBase) cleanupTempDir(tempBase)
    })

    it.skipIf(!binary)(
        'initialize_repository',
        async () => {
            const result = await runBekkCoreRaw(
                binary!,
                ['init', '--repo', toRepoArg(repoPath)],
                password,
            )
            expect(result.status).toBe('ok')
        },
        30_000,
    )

    it.skipIf(!binary)(
        'backup',
        async () => {
            const result = await runBekkCoreRaw(
                binary!,
                ['backup', '--repo', toRepoArg(repoPath), '--source', sourcePath],
                password,
            )
            expect(result.status).toBe('ok')
            if (result.status !== 'ok' || !('data' in result))
                throw new Error('expected ok with data')
            const data = result.data as BackupData
            expect(typeof data.snapshot_id).toBe('string')
            expect(data.snapshot_id.length).toBeGreaterThan(0)
            snapshotId = data.snapshot_id
        },
        60_000,
    )

    it.skipIf(!binary)(
        'snapshots list',
        async () => {
            const result = await runBekkCoreRaw(
                binary!,
                ['snapshots', '--repo', toRepoArg(repoPath)],
                password,
            )
            expect(result.status).toBe('ok')
            if (result.status !== 'ok' || !('data' in result))
                throw new Error('expected ok with data')
            const snapshots = result.data as SnapshotEntry[]
            expect(snapshots.length).toBe(1)
            const first = snapshots.at(0)
            expect(first).toBeDefined()
            expect(first?.id).toBe(snapshotId)
        },
        30_000,
    )

    it.skipIf(!binary)(
        'restore',
        async () => {
            const result = await runBekkCoreRaw(
                binary!,
                [
                    'restore',
                    '--repo',
                    toRepoArg(repoPath),
                    '--snapshot',
                    'latest',
                    '--target',
                    restorePath,
                ],
                password,
            )
            expect(result.status).toBe('ok')
            const restoredHello = findFile(restorePath, 'hello.txt')
            expect(restoredHello).not.toBeNull()
            expect(readFileSync(restoredHello!, 'utf8')).toBe('hello world')
        },
        60_000,
    )

    it.skipIf(!binary)(
        'clean',
        async () => {
            const result = await runBekkCoreRaw(
                binary!,
                ['clean', '--repo', toRepoArg(repoPath)],
                password,
            )
            expect(result.status).toBe('ok')
            if (result.status !== 'ok' || !('data' in result))
                throw new Error('expected ok with data')
            const data = result.data as Record<string, unknown>
            expect(data['prune']).toBeDefined()
            expect(data['check']).toBeDefined()
            expect(data['repair_index']).toBeDefined()
        },
        60_000,
    )
})
