import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

import { join } from 'pathe'

import type { ScheduleConfig } from '#lib/scheduler'

import { linuxScheduler } from '../../src/lib/scheduler/linux'

if (process.platform !== 'linux') {
    throw new Error('test:native:linux must run on Linux')
}

const TEST_LABEL = `bekk-test-${randomUUID()}`
const PROGRAM = process.execPath
const ARGS = ['--version']
const DAILY_CONFIG: ScheduleConfig = { type: 'daily', time: '03:00' }
const TIMER_PATH = join(homedir(), '.config', 'systemd', 'user', `${TEST_LABEL}.timer`)

describe('linuxScheduler (native)', () => {
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
