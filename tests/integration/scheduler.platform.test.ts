/**
 * Platform integration tests for the OS-native scheduler.
 *
 * Each OS block is guarded with it.skipIf() so the suite can run anywhere:
 *   - On Windows  → Windows block runs, macOS/Linux blocks skip
 *   - On macOS    → macOS block runs, others skip
 *   - On Linux    → Linux block runs, others skip
 *   - In CI (non-native) → all skip gracefully
 *
 * Tests use a unique UUID-suffixed task label to avoid colliding with
 * any real bekk-backup task the user may have installed.
 */

import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

import { join } from 'pathe'

import type { ScheduleConfig } from '#lib/scheduler'

import { linuxScheduler } from '../../src/lib/scheduler/linux'
import { macosScheduler } from '../../src/lib/scheduler/macos'
import { windowsScheduler } from '../../src/lib/scheduler/windows'

// ─── shared fixture ───────────────────────────────────────────────────────────

const TEST_LABEL = `bekk-test-${randomUUID()}`
const PROGRAM = process.execPath
const ARGS = ['--version']
const DAILY_CONFIG: ScheduleConfig = { type: 'daily', time: '03:00' }

// ─── Windows ──────────────────────────────────────────────────────────────────

describe('windowsScheduler (live)', () => {
    const skip = process.platform !== 'win32'
    if (skip) {
        it.skip('skipped on non-Windows', () => {})
        return
    }

    afterAll(async () => {
        // Always clean up, even if a test fails
        await windowsScheduler.uninstall(TEST_LABEL).catch(() => {})
    })

    it('status() returns not installed before install', async () => {
        const { installed } = await windowsScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    })

    it('install() registers the task in Task Scheduler', async () => {
        await windowsScheduler.install(TEST_LABEL, PROGRAM, ARGS, DAILY_CONFIG)
        const { installed } = await windowsScheduler.status(TEST_LABEL)
        expect(installed).toBe(true)
    }, 15_000)

    it('uninstall() removes the task', async () => {
        await windowsScheduler.uninstall(TEST_LABEL)
        const { installed } = await windowsScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    }, 15_000)

    it('uninstall() on a non-existent task does not throw', async () => {
        await expect(windowsScheduler.uninstall(TEST_LABEL)).resolves.toBeUndefined()
    })
})

// ─── macOS ────────────────────────────────────────────────────────────────────

describe('macosScheduler (live)', () => {
    const skip = process.platform !== 'darwin'
    if (skip) {
        it.skip('skipped on non-macOS', () => {})
        return
    }

    const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', 'com.bekk.backup.plist')

    afterAll(async () => {
        await macosScheduler.uninstall(TEST_LABEL).catch(() => {})
    })

    it('status() returns not installed before install', async () => {
        const { installed } = await macosScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    })

    it('install() writes plist file and bootstraps launchd', async () => {
        await macosScheduler.install(TEST_LABEL, PROGRAM, ARGS, DAILY_CONFIG)
        // The plist path is fixed to com.bekk.backup regardless of label
        expect(existsSync(PLIST_PATH)).toBe(true)
        const { installed } = await macosScheduler.status(TEST_LABEL)
        expect(installed).toBe(true)
    }, 15_000)

    it('uninstall() removes plist and unregisters from launchd', async () => {
        await macosScheduler.uninstall(TEST_LABEL)
        expect(existsSync(PLIST_PATH)).toBe(false)
        const { installed } = await macosScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    }, 15_000)

    it('uninstall() on a non-existent plist does not throw', async () => {
        await expect(macosScheduler.uninstall(TEST_LABEL)).resolves.toBeUndefined()
    })
})

// ─── Linux ────────────────────────────────────────────────────────────────────

describe('linuxScheduler (live)', () => {
    const skip = process.platform !== 'linux'
    if (skip) {
        it.skip('skipped on non-Linux', () => {})
        return
    }

    const TIMER_PATH = join(homedir(), '.config', 'systemd', 'user', 'bekk-backup.timer')

    afterAll(async () => {
        await linuxScheduler.uninstall(TEST_LABEL).catch(() => {})
    })

    it('status() returns not installed before install', async () => {
        const { installed } = await linuxScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    })

    it('install() writes timer/service files and enables the timer', async () => {
        await linuxScheduler.install(TEST_LABEL, PROGRAM, ARGS, DAILY_CONFIG)
        expect(existsSync(TIMER_PATH)).toBe(true)
        const { installed } = await linuxScheduler.status(TEST_LABEL)
        expect(installed).toBe(true)
    }, 15_000)

    it('uninstall() disables timer and removes files', async () => {
        await linuxScheduler.uninstall(TEST_LABEL)
        expect(existsSync(TIMER_PATH)).toBe(false)
        const { installed } = await linuxScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    }, 15_000)

    it('uninstall() on a non-existent timer does not throw', async () => {
        await expect(linuxScheduler.uninstall(TEST_LABEL)).resolves.toBeUndefined()
    })
})
