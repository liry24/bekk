import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'

import type { ScheduleConfig } from '#lib/scheduler'

import { windowsScheduler } from '../../src/lib/scheduler/windows'

if (process.platform !== 'win32') {
    throw new Error('test:native:windows must run on Windows')
}

const TEST_LABEL = `bekk-test-${randomUUID()}`
const PROGRAM = process.execPath
const ARGS = ['--version']
const DAILY_CONFIG: ScheduleConfig = { type: 'daily', time: '03:00' }

describe('windowsScheduler (native)', () => {
    afterAll(async () => {
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
