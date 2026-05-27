import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

import { join } from 'pathe'

import type { ScheduleConfig } from '#lib/scheduler'

import { macosScheduler } from '../../src/lib/scheduler/macos'

if (process.platform !== 'darwin') {
    throw new Error('test:native:macos must run on macOS')
}

const TEST_LABEL = `bekk-test-${randomUUID()}`
const PROGRAM = process.execPath
const ARGS = ['--version']
const DAILY_CONFIG: ScheduleConfig = { type: 'daily', time: '03:00' }
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `com.bekk.${TEST_LABEL}.plist`)

describe('macosScheduler (native)', () => {
    afterAll(async () => {
        await macosScheduler.uninstall(TEST_LABEL).catch(() => {})
    })

    it('status() returns not installed before install', async () => {
        const { installed } = await macosScheduler.status(TEST_LABEL)
        expect(installed).toBe(false)
    })

    it('install() writes plist file and bootstraps launchd', async () => {
        await macosScheduler.install(TEST_LABEL, PROGRAM, ARGS, DAILY_CONFIG)
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
