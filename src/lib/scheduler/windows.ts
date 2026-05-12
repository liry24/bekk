import { fmtErr } from '#lib/error'

import type { ScheduleConfig, Scheduler } from './types'

const exec = (args: string[]) => {
    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(result.stderr).trim())
    }
    return new TextDecoder().decode(result.stdout).trim()
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
        const command = `"${program}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`
        const taskArgs = ['schtasks', '/create', '/tn', label, '/tr', command, ...triggerArgs, '/f']
        exec(taskArgs)
    },
    async uninstall(label) {
        try {
            exec(['schtasks', '/delete', '/tn', label, '/f'])
        } catch (err) {
            const msg = fmtErr(err)
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
