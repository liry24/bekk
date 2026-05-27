import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

import { join } from 'pathe'

import type { BackupData, SnapshotEntry } from '#bekk-core'

import {
    cleanupTempDir,
    createTestTempDir,
    resolveDebugBinary,
    runBekkCoreRaw,
    runBekkCoreWithoutPassword,
    toRepoArg,
} from '../helpers/bekk-core-runner'

const binary = resolveDebugBinary()
if (!binary) {
    throw new Error(
        '[bekk-core tests] Binary not found. Run `bun run build:core` before this suite.',
    )
}

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
    const newPassword = 'test-password-bekk-new'

    let tempBase = ''
    let repoPath = ''
    let sourcePath = ''
    let restorePath = ''
    let snapshotId = ''

    beforeAll(() => {
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

    it('initialize_repository', async () => {
        const result = await runBekkCoreRaw(
            binary,
            ['init', '--repo', toRepoArg(repoPath)],
            password,
        )
        expect(result.status).toBe('ok')
    }, 30_000)

    it('fails clearly when password stdin is missing', async () => {
        const result = await runBekkCoreWithoutPassword(binary, [
            'snapshots',
            '--repo',
            toRepoArg(repoPath),
        ])
        expect(result.status).toBe('error')
        if (result.status === 'error') {
            expect(result.message).toContain('Password must be provided via stdin')
        }
    }, 30_000)

    it('backup', async () => {
        const result = await runBekkCoreRaw(
            binary,
            ['backup', '--repo', toRepoArg(repoPath), '--source', sourcePath],
            password,
        )
        expect(result.status).toBe('ok')
        if (result.status !== 'ok' || !('data' in result)) throw new Error('expected ok with data')
        const data = result.data as BackupData
        expect(typeof data.snapshot_id).toBe('string')
        expect(data.snapshot_id.length).toBeGreaterThan(0)
        snapshotId = data.snapshot_id
    }, 60_000)

    it('snapshots list', async () => {
        const result = await runBekkCoreRaw(
            binary,
            ['snapshots', '--repo', toRepoArg(repoPath)],
            password,
        )
        expect(result.status).toBe('ok')
        if (result.status !== 'ok' || !('data' in result)) throw new Error('expected ok with data')
        const snapshots = result.data as SnapshotEntry[]
        expect(snapshots.length).toBe(1)
        const first = snapshots.at(0)
        expect(first).toBeDefined()
        expect(first?.id).toBe(snapshotId)
    }, 30_000)

    it('dry-run restore does not write files', async () => {
        const dryRunRestorePath = join(tempBase, 'restore-dry-run')
        mkdirSync(dryRunRestorePath, { recursive: true })

        const result = await runBekkCoreRaw(
            binary,
            [
                'restore',
                '--repo',
                toRepoArg(repoPath),
                '--snapshot',
                'latest',
                '--target',
                dryRunRestorePath,
                '--dry-run',
            ],
            password,
        )
        expect(result.status).toBe('ok')
        expect(findFile(dryRunRestorePath, 'hello.txt')).toBeNull()
    }, 60_000)

    it('restore', async () => {
        const result = await runBekkCoreRaw(
            binary,
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
    }, 60_000)

    it('snapshot limit prunes older snapshots after a successful backup', async () => {
        writeFileSync(join(sourcePath, 'second.txt'), 'second snapshot')
        const result = await runBekkCoreRaw(
            binary,
            [
                'backup',
                '--repo',
                toRepoArg(repoPath),
                '--source',
                sourcePath,
                '--snapshot-limit',
                '1',
            ],
            password,
        )
        expect(result.status).toBe('ok')
        if (result.status !== 'ok' || !('data' in result)) throw new Error('expected ok with data')
        const latest = result.data as BackupData

        const snapshotsResult = await runBekkCoreRaw(
            binary,
            ['snapshots', '--repo', toRepoArg(repoPath)],
            password,
        )
        expect(snapshotsResult.status).toBe('ok')
        if (snapshotsResult.status !== 'ok' || !('data' in snapshotsResult))
            throw new Error('expected ok with data')
        const snapshots = snapshotsResult.data as SnapshotEntry[]
        expect(snapshots).toHaveLength(1)
        expect(snapshots[0]?.id).toBe(latest.snapshot_id)
    }, 60_000)

    it('clean', async () => {
        const result = await runBekkCoreRaw(
            binary,
            ['clean', '--repo', toRepoArg(repoPath)],
            password,
        )
        expect(result.status).toBe('ok')
        if (result.status !== 'ok' || !('data' in result)) throw new Error('expected ok with data')
        const data = result.data as Record<string, unknown>
        expect(data['prune']).toBeDefined()
        expect(data['check']).toBeDefined()
        expect(data['repair_index']).toBeDefined()
    }, 60_000)

    it('refuses force-reinit of a root path', async () => {
        const result = await runBekkCoreRaw(
            binary,
            ['init', '--repo', 'local:/', '--force-reinit'],
            password,
        )
        expect(result.status).toBe('error')
        if (result.status === 'error') {
            expect(result.message).toContain('Refusing to delete a root repository path')
        }
    }, 30_000)

    it('rejects invalid schedule-info inputs', async () => {
        const result = await runBekkCoreWithoutPassword(binary, [
            'schedule-info',
            '--daily',
            '25:00',
        ])
        expect(result.status).toBe('error')
    })

    it('change-password rekeys the repository', async () => {
        const result = await runBekkCoreRaw(
            binary,
            ['change-password', '--repo', toRepoArg(repoPath)],
            password,
            newPassword,
        )
        expect(result.status).toBe('ok')

        const oldPasswordResult = await runBekkCoreRaw(
            binary,
            ['snapshots', '--repo', toRepoArg(repoPath)],
            password,
        )
        expect(oldPasswordResult.status).toBe('error')

        const newPasswordResult = await runBekkCoreRaw(
            binary,
            ['snapshots', '--repo', toRepoArg(repoPath)],
            newPassword,
        )
        expect(newPasswordResult.status).toBe('ok')
    }, 180_000)
})
