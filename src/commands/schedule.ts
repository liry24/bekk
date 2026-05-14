import { bekkCore } from '#bekk-core'
import { unwrapCoreResult } from '#lib/core-helpers'
import { formatError } from '#lib/error'
import { getScheduler } from '#lib/scheduler'
import type { ScheduleConfig, ScheduleEntry } from '#lib/scheduler'
import { bold, cyan, dim, green, red, yellow, writeString } from '#lib/ui'
import { CancelledError, confirm, input, select } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TASK_LABEL_PREFIX = 'bekk-backup'

export const nextTaskLabel = (entries: ScheduleEntry[]): string => {
    if (entries.length === 0) return `${TASK_LABEL_PREFIX}-0`
    const indices = entries.map((e) => {
        const m = e.label.match(/-(\d+)$/)
        return m ? parseInt(m[1]!, 10) : -1
    })
    return `${TASK_LABEL_PREFIX}-${Math.max(...indices) + 1}`
}

export const validateTime = (time: string): string | true => {
    if (!/^\d{1,2}:\d{2}$/.test(time)) return `Invalid time format. Expected HH:MM`
    const [h, m] = time.split(':').map(Number)
    if (h! < 0 || h! > 23 || m! < 0 || m! > 59) return `Invalid time: ${time}`
    return true
}

export const validateDayOfWeek = (day: string): string | true => {
    const valid = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    if (!valid.includes(day.toLowerCase())) return `Invalid day of week: ${day}. Expected mon-sun`
    return true
}

export const validateDayOfMonth = (day: string): string | true => {
    const d = Number(day)
    if (isNaN(d) || !Number.isInteger(d) || d < 1 || d > 31)
        return `Invalid day of month. Expected 1-31`
    return true
}

export const validateInterval = (val: string): string | true => {
    const n = Number(val)
    if (isNaN(n) || !Number.isInteger(n) || n < 1)
        return `Invalid interval. Expected a positive integer (minutes)`
    return true
}

const getProgramAndArgs = (): { program: string; args: string[] } => {
    const isBun = /bun(\.exe)?$/i.test(process.execPath)
    if (isBun) {
        return { program: process.execPath, args: [process.argv[1]!, 'backup'] }
    }
    return { program: process.execPath, args: ['backup'] }
}

export const formatSchedule = (config: ScheduleConfig): string => {
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

export const buildScheduleInfoOpts = (config: ScheduleConfig) => {
    if (config.type === 'daily') return { daily: config.time }
    if (config.type === 'weekly') return { weekly: [config.day!, config.time!] as [string, string] }
    if (config.type === 'monthly')
        return { monthly: [config.day!, config.time!] as [string, string] }
    return { interval: config.interval }
}

// ─── Store helpers (array-based) ──────────────────────────────────────────────

/**
 * Parse a raw JSON string from the store into ScheduleEntry[].
 * Handles legacy single-object migration (old { type: '...' } format).
 * Exported for unit testing (store-free).
 */
export const parseScheduleEntries = (raw: string): ScheduleEntry[] => {
    if (!raw || raw === '{}' || raw === '[]') return []
    try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed as ScheduleEntry[]
        if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
            return [{ label: `${TASK_LABEL_PREFIX}-0`, config: parsed as ScheduleConfig }]
        }
        return []
    } catch {
        return []
    }
}

const readScheduleEntries = async (): Promise<ScheduleEntry[]> => {
    const cfg = await configStore.read()
    const raw = cfg.scheduleConfigJson
    const entries = parseScheduleEntries(raw)
    // Persist migration if a legacy entry was detected
    if (
        raw &&
        raw !== '{}' &&
        raw !== '[]' &&
        entries.length > 0 &&
        !raw.trimStart().startsWith('[')
    ) {
        await configStore.patch({ scheduleConfigJson: JSON.stringify(entries) })
    }
    return entries
}

const saveScheduleEntries = async (entries: ScheduleEntry[]): Promise<void> => {
    await configStore.patch({ scheduleConfigJson: JSON.stringify(entries) })
}

// ─── Interactive schedule builder ─────────────────────────────────────────────

const promptScheduleConfig = async (): Promise<ScheduleConfig> => {
    const type = await select<ScheduleConfig['type']>({
        message: 'Schedule type',
        choices: [
            { label: 'Daily      — run once a day at a specified time', value: 'daily' },
            { label: 'Weekly     — run once a week on a specified day', value: 'weekly' },
            { label: 'Monthly    — run once a month on a specified day', value: 'monthly' },
            { label: 'Interval   — run every N minutes', value: 'interval' },
        ],
    })

    if (type === 'daily') {
        const time = await input({ message: 'Time (HH:MM)', validate: validateTime })
        return { type: 'daily', time }
    }

    if (type === 'weekly') {
        const day = await select<string>({
            message: 'Day of week',
            choices: [
                { label: 'Monday', value: 'mon' },
                { label: 'Tuesday', value: 'tue' },
                { label: 'Wednesday', value: 'wed' },
                { label: 'Thursday', value: 'thu' },
                { label: 'Friday', value: 'fri' },
                { label: 'Saturday', value: 'sat' },
                { label: 'Sunday', value: 'sun' },
            ],
        })
        const time = await input({ message: 'Time (HH:MM)', validate: validateTime })
        return { type: 'weekly', day, time }
    }

    if (type === 'monthly') {
        const day = await input({ message: 'Day of month (1-31)', validate: validateDayOfMonth })
        const time = await input({ message: 'Time (HH:MM)', validate: validateTime })
        return { type: 'monthly', day, time }
    }

    // interval
    const rawInterval = await input({ message: 'Interval in minutes', validate: validateInterval })
    return { type: 'interval', interval: parseInt(rawInterval, 10) }
}

// ─── schedule add ─────────────────────────────────────────────────────────────

const addCmd = app
    .sub('schedule')
    .sub('add')
    .meta({ description: 'Register a scheduled backup task' })
    .flags({
        daily: { type: 'string', description: 'Daily schedule (HH:MM)' },
        weekly: { type: 'string', description: 'Weekly schedule ("DOW HH:MM")' },
        monthly: { type: 'string', description: 'Monthly schedule ("DAY HH:MM")' },
        interval: { type: 'number', description: 'Interval in minutes' },
    })
    .run(async ({ flags }) => {
        let config: ScheduleConfig

        const hasFlag =
            flags.daily !== undefined ||
            flags.weekly !== undefined ||
            flags.monthly !== undefined ||
            flags.interval !== undefined

        if (hasFlag) {
            // Non-interactive: parse from flags
            if (flags.daily) {
                const v = validateTime(flags.daily.trim())
                if (v !== true) {
                    writeString(red('Error: ') + v)
                    process.exit(1)
                }
                config = { type: 'daily', time: flags.daily.trim() }
            } else if (flags.weekly) {
                const parts = flags.weekly.trim().split(/\s+/)
                if (parts.length !== 2) {
                    writeString(red('Error: ') + 'Weekly schedule must be "DOW HH:MM"')
                    process.exit(1)
                }
                const vd = validateDayOfWeek(parts[0]!)
                if (vd !== true) {
                    writeString(red('Error: ') + vd)
                    process.exit(1)
                }
                const vt = validateTime(parts[1]!)
                if (vt !== true) {
                    writeString(red('Error: ') + vt)
                    process.exit(1)
                }
                config = { type: 'weekly', day: parts[0], time: parts[1] }
            } else if (flags.monthly) {
                const parts = flags.monthly.trim().split(/\s+/)
                if (parts.length !== 2) {
                    writeString(red('Error: ') + 'Monthly schedule must be "DAY HH:MM"')
                    process.exit(1)
                }
                const vd = validateDayOfMonth(parts[0]!)
                if (vd !== true) {
                    writeString(red('Error: ') + vd)
                    process.exit(1)
                }
                const vt = validateTime(parts[1]!)
                if (vt !== true) {
                    writeString(red('Error: ') + vt)
                    process.exit(1)
                }
                config = { type: 'monthly', day: parts[0], time: parts[1] }
            } else {
                config = { type: 'interval', interval: flags.interval! }
            }
        } else {
            // Interactive mode
            try {
                config = await promptScheduleConfig()
            } catch (err) {
                if (err instanceof CancelledError) process.exit(0)
                writeString(red('Error: ') + formatError(err))
                process.exit(1)
            }
        }

        try {
            unwrapCoreResult(await bekkCore.scheduleInfo(buildScheduleInfoOpts(config)))
        } catch (err) {
            writeString(red('Invalid schedule: ') + formatError(err))
            process.exit(1)
        }

        const entries = await readScheduleEntries()
        const label = nextTaskLabel(entries)
        const scheduler = getScheduler()
        const { program, args } = getProgramAndArgs()

        try {
            await scheduler.install(label, program, args, config)
        } catch (err) {
            writeString(red('Failed to install schedule: ') + formatError(err))
            process.exit(1)
        }

        await saveScheduleEntries([...entries, { label, config }])
        console.log(green('✓ ') + bold('Schedule registered') + dim(` (${label})`))
        console.log(dim('  ') + formatSchedule(config))
    })

// ─── schedule rm ──────────────────────────────────────────────────────────────

const rmCmd = app
    .sub('schedule')
    .sub('rm')
    .meta({ description: 'Remove a scheduled backup task' })
    .flags({
        all: { type: 'boolean', description: 'Remove all scheduled tasks' },
    })
    .run(async ({ flags }) => {
        const entries = await readScheduleEntries()

        if (entries.length === 0) {
            console.log(dim('  No schedules configured.'))
            return
        }

        const scheduler = getScheduler()

        if (flags.all) {
            console.log(bold('Scheduled tasks to be removed:'))
            for (const e of entries) {
                console.log(dim('  • ') + cyan(e.label) + dim(' — ') + formatSchedule(e.config))
            }
            console.log()

            let confirmed: boolean
            try {
                confirmed = await confirm({ message: `Remove all ${entries.length} schedule(s)?` })
            } catch {
                process.exit(0)
            }

            if (!confirmed) {
                console.log(yellow('Aborted.'))
                return
            }

            const failed: string[] = []
            for (const e of entries) {
                try {
                    await scheduler.uninstall(e.label)
                } catch (err) {
                    failed.push(`${e.label}: ${formatError(err)}`)
                }
            }

            await saveScheduleEntries([])

            if (failed.length > 0) {
                for (const msg of failed) writeString(red('Warning: ') + msg)
            }

            console.log(green('✓ ') + bold(`All schedules removed`))
            return
        }

        // Select one to remove
        let chosen: ScheduleEntry
        try {
            chosen = await select<ScheduleEntry>({
                message: 'Select schedule to remove',
                choices: entries.map((e) => ({
                    label: `${e.label}  ${dim(formatSchedule(e.config))}`,
                    value: e,
                })),
            })
        } catch (err) {
            if (err instanceof CancelledError) process.exit(0)
            writeString(red('Error: ') + formatError(err))
            process.exit(1)
        }

        try {
            await scheduler.uninstall(chosen.label)
        } catch (err) {
            writeString(red('Failed to remove schedule: ') + formatError(err))
            process.exit(1)
        }

        await saveScheduleEntries(entries.filter((e) => e.label !== chosen.label))
        console.log(green('✓ ') + bold('Schedule removed') + dim(` (${chosen.label})`))
    })

// ─── schedule (default) ───────────────────────────────────────────────────────

const showStatus = async () => {
    const entries = await readScheduleEntries()
    const scheduler = getScheduler()

    console.log(bold('Backup Schedules'))
    console.log()

    if (entries.length === 0) {
        console.log(dim('  No schedules configured.'))
    } else {
        for (const entry of entries) {
            const status = await scheduler.status(entry.label)
            console.log(dim('  Label:    ') + cyan(entry.label))
            console.log(
                dim('  Status:   ') +
                    (status.installed ? green('Installed') : yellow('Not installed')),
            )
            console.log(dim('  Details:  ') + cyan(formatSchedule(entry.config)))

            try {
                const result = unwrapCoreResult(
                    await bekkCore.scheduleInfo(buildScheduleInfoOpts(entry.config)),
                )
                if (result?.next_run) {
                    const next = new Date(result.next_run)
                    console.log(dim('  Next run: ') + cyan(next.toLocaleString()))
                }
            } catch {
                // ignore errors fetching next run
            }

            console.log()
        }
    }

    console.log(bold('Usage'))
    console.log(dim('  ') + 'bekk schedule add                        (interactive)')
    console.log(dim('  ') + 'bekk schedule add --daily HH:MM')
    console.log(dim('  ') + 'bekk schedule add --weekly "DOW HH:MM"')
    console.log(dim('  ') + 'bekk schedule add --monthly "DAY HH:MM"')
    console.log(dim('  ') + 'bekk schedule add --interval MINUTES')
    console.log(dim('  ') + 'bekk schedule rm')
    console.log(dim('  ') + 'bekk schedule rm --all')
}

export const scheduleCmd = app
    .sub('schedule')
    .meta({ description: 'Manage the automated backup schedule' })
    .command(addCmd)
    .command(rmCmd)
    .run(async () => {
        await showStatus()
    })
