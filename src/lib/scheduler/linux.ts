import { homedir } from 'node:os'

import { join } from 'pathe'

import type { ScheduleConfig, Scheduler } from './types'

const LABEL = 'bekk-backup'
const SERVICE_DIR = join(homedir(), '.config', 'systemd', 'user')
const SERVICE_PATH = join(SERVICE_DIR, `${LABEL}.service`)
const TIMER_PATH = join(SERVICE_DIR, `${LABEL}.timer`)

/**
 * Escape an argument for systemd ExecStart= lines.
 */
export const escapeSystemdArg = (arg: string): string => {
    if (!/[ \t\n\r"\\$`]/.test(arg)) return arg
    return '"' + arg.replace(/(["\\$`])/g, '\\$1') + '"'
}

export const buildService = (program: string, args: string[]) =>
    `[Unit]
Description=bekk scheduled backup

[Service]
Type=oneshot
ExecStart=${escapeSystemdArg(program)} ${args.map(escapeSystemdArg).join(' ')}

[Install]
WantedBy=default.target
`

export const buildTimer = (config: ScheduleConfig) => {
    if (config.type === 'interval') {
        return `[Unit]
Description=bekk backup timer

[Timer]
OnBootSec=1min
OnUnitActiveSec=${config.interval}m

[Install]
WantedBy=timers.target
`
    }

    let onCalendar = ''
    switch (config.type) {
        case 'daily':
            onCalendar = `*-*-* ${config.time}:00`
            break
        case 'weekly': {
            const dowMap: Record<string, string> = {
                mon: 'Mon',
                tue: 'Tue',
                wed: 'Wed',
                thu: 'Thu',
                fri: 'Fri',
                sat: 'Sat',
                sun: 'Sun',
            }
            onCalendar = `${dowMap[config.day!.toLowerCase()]} *-*-* ${config.time}:00`
            break
        }
        case 'monthly':
            onCalendar = `*-*-${config.day!.padStart(2, '0')} ${config.time}:00`
            break
    }

    return `[Unit]
Description=bekk backup timer

[Timer]
OnCalendar=${onCalendar}
Persistent=true

[Install]
WantedBy=timers.target
`
}

const exec = (args: string[]) => {
    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(result.stderr).trim())
    }
}

export const linuxScheduler: Scheduler = {
    async install(_label, program, args, config) {
        exec(['mkdir', '-p', SERVICE_DIR])
        await Bun.write(SERVICE_PATH, buildService(program, args))
        await Bun.write(TIMER_PATH, buildTimer(config))
        exec(['systemctl', '--user', 'daemon-reload'])
        exec(['systemctl', '--user', 'enable', '--now', `${LABEL}.timer`])
    },
    async uninstall(_label) {
        try {
            exec(['systemctl', '--user', 'disable', '--now', `${LABEL}.timer`])
        } catch {
            // ignore
        }
        try {
            exec(['rm', '-f', TIMER_PATH, SERVICE_PATH])
        } catch {
            // ignore
        }
        try {
            exec(['systemctl', '--user', 'daemon-reload'])
        } catch {
            // ignore
        }
    },
    async status(_label) {
        const exists = await Bun.file(TIMER_PATH).exists()
        return { installed: exists }
    },
}
