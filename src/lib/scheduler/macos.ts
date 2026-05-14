import { homedir } from 'node:os'

import { join } from 'pathe'

import type { ScheduleConfig, Scheduler } from './types'

const FALLBACK_MACOS_UID = 501

const launchLabel = (label: string) => `com.bekk.${label}`
const plistPath = (label: string) =>
    join(homedir(), 'Library', 'LaunchAgents', `${launchLabel(label)}.plist`)

/**
 * Escape text for XML plist <string> elements.
 */
export const escapeXml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const buildPlist = (
    label: string,
    program: string,
    args: string[],
    config: ScheduleConfig,
): string => {
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
    const ll = launchLabel(label)

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(ll)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(program)}</string>
${args.map((a) => `        <string>${escapeXml(a)}</string>`).join('\n')}
    </array>
${intervalXml}
    <key>StandardOutPath</key>
    <string>${escapeXml(join(logDir, `${label}.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(join(logDir, `${label}-error.log`))}</string>
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
    async install(label, program, args, config) {
        const path = plistPath(label)
        await Bun.write(path, buildPlist(label, program, args, config))
        const uid = String(process.getuid?.() ?? FALLBACK_MACOS_UID)
        exec(['launchctl', 'bootstrap', `gui/${uid}`, path])
    },
    async uninstall(label) {
        const path = plistPath(label)
        if (!(await Bun.file(path).exists())) return
        const uid = String(process.getuid?.() ?? FALLBACK_MACOS_UID)
        try {
            exec(['launchctl', 'bootout', `gui/${uid}`, path])
        } catch {
            // ignore
        }
        try {
            exec(['rm', '-f', path])
        } catch {
            // ignore
        }
    },
    async status(label) {
        const exists = await Bun.file(plistPath(label)).exists()
        return { installed: exists }
    },
}
