import { bekkCore } from '#bekk-core'
import { unwrapCoreResult } from '#lib/core-helpers'
import { fmtErr } from '#lib/error'
import { getScheduler } from '#lib/scheduler'
import type { ScheduleConfig } from '#lib/scheduler'
import { bold, cyan, dim, green, red, writeString } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

const TASK_LABEL = 'bekk-backup'

const parseScheduleConfig = (flags: {
    daily?: string
    weekly?: string
    monthly?: string
    interval?: number
}): ScheduleConfig => {
    if (flags.daily) {
        return { type: 'daily', time: flags.daily.trim() }
    }
    if (flags.weekly) {
        const parts = flags.weekly.trim().split(/\s+/)
        if (parts.length !== 2) {
            throw new Error('Weekly schedule must be "DOW HH:MM"')
        }
        return { type: 'weekly', day: parts[0], time: parts[1] }
    }
    if (flags.monthly) {
        const parts = flags.monthly.trim().split(/\s+/)
        if (parts.length !== 2) {
            throw new Error('Monthly schedule must be "DAY HH:MM"')
        }
        return { type: 'monthly', day: parts[0], time: parts[1] }
    }
    if (flags.interval !== undefined) {
        return { type: 'interval', interval: flags.interval }
    }
    throw new Error('No schedule option provided')
}

const validateTime = (time: string) => {
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
        throw new Error(`Invalid time format: ${time}. Expected HH:MM`)
    }
    const [h, m] = time.split(':').map(Number)
    if (h! < 0 || h! > 23 || m! < 0 || m! > 59) {
        throw new Error(`Invalid time: ${time}`)
    }
}

const validateDay = (type: 'weekly' | 'monthly', day: string) => {
    if (type === 'weekly') {
        const valid = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        if (!valid.includes(day.toLowerCase())) {
            throw new Error(`Invalid day of week: ${day}`)
        }
    } else {
        const d = Number(day)
        if (isNaN(d) || d < 1 || d > 31) {
            throw new Error(`Invalid day of month: ${day}`)
        }
    }
}

const getProgramAndArgs = (): { program: string; args: string[] } => {
    const isBun = /bun(\.exe)?$/i.test(process.execPath)
    if (isBun) {
        return { program: process.execPath, args: [process.argv[1]!, 'backup'] }
    }
    return { program: process.execPath, args: ['backup'] }
}

const saveScheduleConfig = async (config: ScheduleConfig) => {
    await configStore.patch({ scheduleConfigJson: JSON.stringify(config) })
}

const clearScheduleConfig = async () => {
    await configStore.patch({ scheduleConfigJson: '{}' })
}

const readScheduleConfig = async (): Promise<ScheduleConfig | null> => {
    const cfg = await configStore.read()
    if (!cfg.scheduleConfigJson || cfg.scheduleConfigJson === '{}') return null
    try {
        return JSON.parse(cfg.scheduleConfigJson) as ScheduleConfig
    } catch {
        return null
    }
}

const formatSchedule = (config: ScheduleConfig): string => {
    switch (config.type) {
        case 'daily':
            return `Daily at ${config.time}`
        case 'weekly':
            return `Weekly on ${config.day} at ${config.time}`
        case 'monthly':
            return `Monthly on day ${config.day} at ${config.time}`
        case 'interval':
            return `Every ${config.interval} minutes`
    }
}

const buildScheduleInfoOpts = (config: ScheduleConfig) => {
    if (config.type === 'daily') return { daily: config.time }
    if (config.type === 'weekly') return { weekly: [config.day!, config.time!] as [string, string] }
    if (config.type === 'monthly')
        return { monthly: [config.day!, config.time!] as [string, string] }
    return { interval: config.interval }
}

// ─── schedule add ─────────────────────────────────────────────────────────────

const addCmd = app
    .sub('schedule')
    .sub('add')
    .meta({ description: 'Register a scheduled backup task' })
    .flags({
        daily: { type: 'string', description: 'Daily schedule (HH:MM)' },
        weekly: { type: 'string', description: 'Weekly schedule (DOW HH:MM)' },
        monthly: { type: 'string', description: 'Monthly schedule (DAY HH:MM)' },
        interval: { type: 'number', description: 'Interval in minutes' },
    })
    .run(async ({ flags }) => {
        let config: ScheduleConfig
        try {
            config = parseScheduleConfig(flags as never)
        } catch (err) {
            writeString(red('Error: ') + fmtErr(err))
            process.exit(1)
        }

        if (config.time) validateTime(config.time)
        if (config.type === 'weekly' || config.type === 'monthly') {
            validateDay(config.type, config.day!)
        }

        try {
            unwrapCoreResult(await bekkCore.scheduleInfo(buildScheduleInfoOpts(config)))
        } catch (err) {
            writeString(red('Invalid schedule: ') + fmtErr(err))
            process.exit(1)
        }

        const scheduler = getScheduler()
        const { program, args } = getProgramAndArgs()

        try {
            await scheduler.install(TASK_LABEL, program, args, config)
        } catch (err) {
            writeString(red('Failed to install schedule: ') + fmtErr(err))
            process.exit(1)
        }

        await saveScheduleConfig(config)
        console.log(green('✓ ') + bold('Schedule registered'))
        console.log(dim('  ') + formatSchedule(config))
    })

// ─── schedule rm ──────────────────────────────────────────────────────────────

const rmCmd = app
    .sub('schedule')
    .sub('rm')
    .meta({ description: 'Remove the scheduled backup task' })
    .run(async () => {
        const scheduler = getScheduler()

        try {
            await scheduler.uninstall(TASK_LABEL)
        } catch (err) {
            writeString(red('Failed to remove schedule: ') + fmtErr(err))
            process.exit(1)
        }

        await clearScheduleConfig()
        console.log(green('✓ ') + bold('Schedule removed'))
    })

// ─── schedule (default) ───────────────────────────────────────────────────────

const showStatus = async () => {
    const config = await readScheduleConfig()
    const scheduler = getScheduler()
    const status = await scheduler.status(TASK_LABEL)

    console.log(bold('Backup Schedule'))
    console.log()

    if (!config || !status.installed) {
        console.log(dim('  No schedule configured.'))
    } else {
        console.log(dim('  Status:   ') + green('Installed'))
        console.log(dim('  Type:     ') + cyan(config.type))
        console.log(dim('  Details:  ') + cyan(formatSchedule(config)))

        try {
            const result = unwrapCoreResult(
                await bekkCore.scheduleInfo(buildScheduleInfoOpts(config)),
            )
            if (result?.next_run) {
                const next = new Date(result.next_run)
                console.log(dim('  Next run: ') + cyan(next.toLocaleString()))
            }
        } catch {
            // ignore errors fetching next run
        }
    }

    console.log()
    console.log(bold('Usage'))
    console.log(dim('  ') + 'bekk schedule add --daily HH:MM')
    console.log(dim('  ') + 'bekk schedule add --weekly "DOW HH:MM"')
    console.log(dim('  ') + 'bekk schedule add --monthly "DAY HH:MM"')
    console.log(dim('  ') + 'bekk schedule add --interval MINUTES')
    console.log(dim('  ') + 'bekk schedule rm')
}

export const scheduleCmd = app
    .sub('schedule')
    .meta({ description: 'Manage the automated backup schedule' })
    .command(addCmd)
    .command(rmCmd)
    .run(async () => {
        await showStatus()
    })
