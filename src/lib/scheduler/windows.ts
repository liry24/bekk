import { formatError } from '#lib/error'

import type { ScheduleConfig, Scheduler } from './types'

const exec = (args: string[]) => {
    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(result.stderr).trim())
    }
    return new TextDecoder().decode(result.stdout).trim()
}

/**
 * Escape an argument for Windows command-line parsing (CommandLineToArgvW rules).
 */
const escapeWindowsArg = (arg: string): string => {
    if (!/[ \t\n\r"\\]/.test(arg)) return arg
    let escaped = '"'
    for (let i = 0; i < arg.length; i++) {
        let backslashCount = 0
        while (i < arg.length && arg[i] === '\\') {
            backslashCount++
            i++
        }
        if (i === arg.length) {
            escaped += '\\'.repeat(backslashCount * 2)
            break
        }
        if (arg[i] === '"') {
            escaped += '\\'.repeat(backslashCount * 2 + 1) + '"'
        } else {
            escaped += '\\'.repeat(backslashCount) + arg[i]
        }
    }
    escaped += '"'
    return escaped
}

const buildTriggerArgs = (config: ScheduleConfig): string[] => {
    switch (config.type) {
        case 'daily':
            return ['/sc', 'daily', '/st', config.time!]
        case 'weekly': {
            const dowMap: Record<string, string> = {
                mon: 'MON',
                tue: 'TUE',
                wed: 'WED',
                thu: 'THU',
                fri: 'FRI',
                sat: 'SAT',
                sun: 'SUN',
            }
            return ['/sc', 'weekly', '/d', dowMap[config.day!.toLowerCase()]!, '/st', config.time!]
        }
        case 'monthly':
            return ['/sc', 'monthly', '/d', config.day!, '/st', config.time!]
        case 'interval':
            return ['/sc', 'minute', '/mo', String(config.interval!)]
        default:
            throw new Error('Unknown schedule type')
    }
}

export const windowsScheduler: Scheduler = {
    async install(label, program, args, config) {
        const triggerArgs = buildTriggerArgs(config)
        const command = [program, ...args].map(escapeWindowsArg).join(' ')
        const taskArgs = ['schtasks', '/create', '/tn', label, '/tr', command, ...triggerArgs, '/f']
        exec(taskArgs)
    },
    async uninstall(label) {
        try {
            exec(['schtasks', '/delete', '/tn', label, '/f'])
        } catch (err) {
            const msg = formatError(err)
            if (msg.includes('not found') || msg.includes('ERROR: The system cannot find')) return
            throw err
        }
    },
    async status(label) {
        try {
            exec(['schtasks', '/query', '/tn', label, '/fo', 'list'])
            return { installed: true }
        } catch {
            return { installed: false }
        }
    },
}
