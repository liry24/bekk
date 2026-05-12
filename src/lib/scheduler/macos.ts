import { homedir } from 'node:os'

import { join } from 'pathe'

import type { ScheduleConfig, Scheduler } from './types'

const LABEL = 'com.bekk.backup'
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

const buildPlist = (program: string, args: string[], config: ScheduleConfig): string => {
    let intervalXml = ''
    if (config.type === 'interval') {
        intervalXml = `    <key>StartInterval</key>\n    <integer>${config.interval! * 60}</integer>`
    } else {
        let dict = ''
        if (config.time) {
            const [hour, minute] = config.time.split(':')
            dict += `        <key>Hour</key>\n        <integer>${Number(hour)}</integer>\n        <key>Minute</key>\n        <integer>${Number(minute)}</integer>\n`
        }
        if (config.type === 'weekly') {
            const dowMap: Record<string, number> = {
                mon: 1,
                tue: 2,
                wed: 3,
                thu: 4,
                fri: 5,
                sat: 6,
                sun: 0,
            }
            dict += `        <key>Weekday</key>\n        <integer>${dowMap[config.day!.toLowerCase()]}</integer>\n`
        } else if (config.type === 'monthly') {
            dict += `        <key>Day</key>\n        <integer>${Number(config.day)}</integer>\n`
        }
        intervalXml = `    <key>StartCalendarInterval</key>\n    <dict>\n${dict}    </dict>`
    }

    const logDir = join(homedir(), 'Library', 'Logs')

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${program}</string>
${args.map((a) => `        <string>${a}</string>`).join('\n')}
    </array>
${intervalXml}
    <key>StandardOutPath</key>
    <string>${join(logDir, 'bekk-backup.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(logDir, 'bekk-backup-error.log')}</string>
</dict>
</plist>`
}

const exec = (args: string[]) => {
    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(result.stderr).trim())
    }
}

export const macosScheduler: Scheduler = {
    async install(_label, program, args, config) {
        await Bun.write(PLIST_PATH, buildPlist(program, args, config))
        const uid = String(process.getuid?.() ?? 501)
        exec(['launchctl', 'bootstrap', `gui/${uid}`, PLIST_PATH])
    },
    async uninstall(_label) {
        if (!(await Bun.file(PLIST_PATH).exists())) return
        const uid = String(process.getuid?.() ?? 501)
        try {
            exec(['launchctl', 'bootout', `gui/${uid}`, PLIST_PATH])
        } catch {
            // ignore
        }
        try {
            exec(['rm', '-f', PLIST_PATH])
        } catch {
            // ignore
        }
    },
    async status(_label) {
        const exists = await Bun.file(PLIST_PATH).exists()
        return { installed: exists }
    },
}
