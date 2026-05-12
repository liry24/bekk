import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { promptValidator } from '@crustjs/validate/zod'
import { join } from 'pathe'
import { z } from 'zod'

import { fmtErr } from '#lib/error'
import { isAdmin } from '#lib/platform'
import { input, bold, cyan, dim, green, red, yellow, writeString } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

const TASK_NAME = 'BekkDaemon'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getBinaryPath = () => process.execPath

const exec = (
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string>; debug?: boolean },
) => {
    const { debug, ...spawnOpts } = opts ?? {}
    if (debug) {
        console.log(
            dim('[debug] exec:'),
            args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '),
        )
    }
    const result = Bun.spawnSync(args, { ...spawnOpts, stdout: 'pipe', stderr: 'pipe' })
    if (debug) {
        console.log(dim('[debug] exitCode:'), result.exitCode)
        if (result.stdout.length > 0)
            console.log(dim('[debug] stdout:'), new TextDecoder().decode(result.stdout).trim())
        if (result.stderr.length > 0)
            console.log(dim('[debug] stderr:'), new TextDecoder().decode(result.stderr).trim())
    }
    if (result.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(result.stderr).trim())
    }
    return new TextDecoder().decode(result.stdout).trim()
}

// Windows ──────────────────────────────────────────────────────────────────────

const getWindowsStartupDir = () =>
    join(
        homedir(),
        'AppData',
        'Roaming',
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Startup',
    )

const getWindowsShortcutPath = () => join(getWindowsStartupDir(), 'BekkDaemon.lnk')

const registerWindows = (exePath: string, admin: boolean, debug?: boolean) => {
    if (admin) {
        const trigger = '/sc onstart'
        const ruParam = '/ru SYSTEM'
        try {
            exec(
                [
                    'schtasks',
                    '/create',
                    '/tn',
                    TASK_NAME,
                    '/tr',
                    `${exePath} daemon`,
                    ...trigger.split(' '),
                    ...ruParam.split(' '),
                    '/f',
                ],
                { debug },
            )
        } catch (err) {
            throw new Error(`schtasks failed: ${fmtErr(err)}`)
        }
        return
    }

    // Non-admin: create a startup folder shortcut
    const startupDir = getWindowsStartupDir()
    const shortcutPath = getWindowsShortcutPath()

    if (debug) {
        console.log(dim('[debug] startupDir:'), startupDir)
        console.log(dim('[debug] shortcutPath:'), shortcutPath)
    }

    const psScript = `
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$sc.TargetPath = '${exePath.replace(/'/g, "''")}'
$sc.Arguments = 'daemon'
$sc.WorkingDirectory = '${process.cwd().replace(/'/g, "''")}'
$sc.Save()
`
    const tmpPs = join(homedir(), 'AppData', 'Local', 'Temp', 'bekk-create-lnk.ps1')
    writeFileSync(tmpPs, psScript)
    try {
        exec(['powershell', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { debug })
    } catch (err) {
        throw new Error(`Failed to create startup shortcut: ${fmtErr(err)}`)
    }
}

const unregisterWindows = (debug?: boolean) => {
    // Try to remove scheduled task (admin case)
    try {
        exec(['schtasks', '/delete', '/tn', TASK_NAME, '/f'], { debug })
    } catch (err) {
        const msg = fmtErr(err)
        if (!msg.includes('not found') && !msg.includes('ERROR: The system cannot find')) {
            if (debug) console.log(dim('[debug] schtasks delete failed (non-fatal):'), msg)
        }
    }

    // Remove startup shortcut (non-admin case)
    const shortcutPath = getWindowsShortcutPath()
    if (existsSync(shortcutPath)) {
        if (debug) console.log(dim('[debug] removing shortcut:'), shortcutPath)
        try {
            unlinkSync(shortcutPath)
        } catch (err) {
            if (debug) console.log(dim('[debug] unlink failed (non-fatal):'), fmtErr(err))
        }
    }
}

// macOS ────────────────────────────────────────────────────────────────────────

const getMacOSPlistPath = (admin: boolean) =>
    admin
        ? `/Library/LaunchDaemons/com.bekk.daemon.plist`
        : join(homedir(), 'Library', 'LaunchAgents', 'com.bekk.daemon.plist')

const buildMacOSPlist = (exePath: string, admin: boolean) => {
    const label = 'com.bekk.daemon'
    const logDir = admin ? '/var/log' : join(homedir(), 'Library', 'Logs')
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${exePath}</string>
        <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${join(logDir, 'bekk-daemon.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(logDir, 'bekk-daemon-error.log')}</string>
</dict>
</plist>`
}

const registerMacOS = async (exePath: string, admin: boolean) => {
    const plistPath = getMacOSPlistPath(admin)
    await Bun.write(plistPath, buildMacOSPlist(exePath, admin))

    if (admin) {
        exec(['launchctl', 'load', plistPath])
    } else {
        const uid = String(process.getuid?.() ?? 501)
        exec(['launchctl', 'bootstrap', `gui/${uid}`, plistPath])
    }
}

const unregisterMacOS = async (admin: boolean) => {
    const plistPath = getMacOSPlistPath(admin)
    if (!(await Bun.file(plistPath).exists())) return

    if (admin) {
        exec(['launchctl', 'unload', plistPath])
    } else {
        const uid = String(process.getuid?.() ?? 501)
        exec(['launchctl', 'bootout', `gui/${uid}`, plistPath])
    }
    try {
        exec(['rm', '-f', plistPath])
    } catch {
        // ignore
    }
}

// Linux ────────────────────────────────────────────────────────────────────────

const getLinuxServicePath = (admin: boolean) =>
    admin
        ? '/etc/systemd/system/bekk-daemon.service'
        : join(homedir(), '.config', 'systemd', 'user', 'bekk-daemon.service')

const buildLinuxUnit = (exePath: string) => `[Unit]
Description=bekk backup daemon
After=network.target

[Service]
Type=simple
ExecStart=${exePath} daemon
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`

const registerLinux = async (exePath: string, admin: boolean) => {
    const servicePath = getLinuxServicePath(admin)
    const serviceDir = servicePath.replace(/\/[^/]+$/, '')
    exec(['mkdir', '-p', serviceDir])
    await Bun.write(servicePath, buildLinuxUnit(exePath))

    const args = admin
        ? ['systemctl', 'enable', '--now', 'bekk-daemon']
        : ['systemctl', '--user', 'enable', '--now', 'bekk-daemon']
    try {
        exec(args)
    } catch (err) {
        throw new Error(`systemctl failed: ${fmtErr(err)}`)
    }
}

const unregisterLinux = async (admin: boolean) => {
    const stopArgs = admin
        ? ['systemctl', 'disable', '--now', 'bekk-daemon']
        : ['systemctl', '--user', 'disable', '--now', 'bekk-daemon']
    try {
        exec(stopArgs)
    } catch {
        // ignore stop errors
    }

    const servicePath = getLinuxServicePath(admin)
    try {
        exec(['rm', '-f', servicePath])
    } catch {
        // ignore
    }
}

// ─── schedule register ────────────────────────────────────────────────────────

const registerCmd = app
    .sub('schedule')
    .sub('register')
    .meta({ description: 'Register bekk daemon as a startup service and set cron schedule' })
    .flags({
        debug: { type: 'boolean', short: 'd', description: 'Enable debug logging' },
        cron: { type: 'string', short: 'c', description: 'Cron expression (e.g. "0 2 * * *")' },
    })
    .run(async ({ flags }) => {
        const admin = isAdmin()
        const exePath = getBinaryPath()
        const debug = flags.debug
        const cronFlag = flags.cron?.trim()

        if (debug) {
            console.log(dim('[debug] platform:'), process.platform)
            console.log(dim('[debug] admin:'), admin)
            console.log(dim('[debug] exePath:'), exePath)
        }

        console.log(bold(cyan('=== bekk Schedule Registration ===')))
        console.log()
        if (admin) console.log(green('  [Admin] Daemon will run as a system service.'))
        else console.log(yellow('  [User] Daemon will run as the current user.'))

        console.log()

        let trimmedExpr: string
        if (cronFlag) {
            trimmedExpr = cronFlag
            const next = Bun.cron.parse(trimmedExpr)
            if (next === null) {
                writeString(red('Invalid cron expression: ') + trimmedExpr)
                process.exit(1)
            }
            console.log(dim('  Schedule: ') + cyan(trimmedExpr))
            console.log(dim('  Next run: ') + cyan(next.toLocaleString()) + dim(' (UTC-based)'))
            console.log()
        } else {
            const cronExpr = await input({
                message: 'Cron expression (e.g. "0 2 * * *" for daily at 02:00 UTC)',
                validate: promptValidator(
                    z.string().refine((v) => Bun.cron.parse(v.trim()) !== null, {
                        message: 'Invalid cron expression',
                    }),
                ),
            })

            trimmedExpr = cronExpr.trim()
            const next = Bun.cron.parse(trimmedExpr)!

            console.log()
            console.log(dim('  Binary:   ') + dim(exePath))
            console.log(dim('  Schedule: ') + cyan(trimmedExpr))
            console.log(dim('  Next run: ') + cyan(next.toLocaleString()) + dim(' (UTC-based)'))
            console.log()
        }

        try {
            if (process.platform === 'win32') registerWindows(exePath, admin, debug)
            else if (process.platform === 'darwin') await registerMacOS(exePath, admin)
            else await registerLinux(exePath, admin)
        } catch (err) {
            writeString(red('Failed to register startup task: ') + fmtErr(err))
            process.exit(1)
        }

        await configStore.patch({ cronSchedule: trimmedExpr })

        console.log(green('✓ ' + bold('Daemon registered.')))
        console.log(dim('  Start manually now with: ') + cyan('bekk daemon'))
    })

// ─── schedule unregister ──────────────────────────────────────────────────────

const unregisterCmd = app
    .sub('schedule')
    .sub('unregister')
    .meta({ description: 'Remove bekk daemon startup service and clear the cron schedule' })
    .flags({
        debug: { type: 'boolean', short: 'd', description: 'Enable debug logging' },
    })
    .run(async ({ flags }) => {
        const admin = isAdmin()
        const debug = flags.debug

        try {
            if (process.platform === 'win32') unregisterWindows(debug)
            else if (process.platform === 'darwin') await unregisterMacOS(admin)
            else await unregisterLinux(admin)
        } catch (err) {
            writeString(red('Failed to remove startup task: ') + fmtErr(err))
            process.exit(1)
        }

        await configStore.patch({ cronSchedule: '' })
        console.log(green('✓ ' + bold('Daemon unregistered and schedule cleared.')))
    })

// ─── schedule status ──────────────────────────────────────────────────────────

const statusCmd = app
    .sub('schedule')
    .sub('status')
    .meta({ description: 'Show current backup schedule and next run time' })
    .run(async () => {
        const cfg = await configStore.read()

        if (!cfg.cronSchedule) {
            writeString('No schedule configured. Run ' + cyan('bekk schedule register') + '.')
            return
        }

        const next = Bun.cron.parse(cfg.cronSchedule)
        console.log(bold('Backup Schedule'))
        console.log(dim('  Expression: ') + cyan(cfg.cronSchedule))
        console.log(
            dim('  Next run:   ') +
                (next
                    ? cyan(next.toLocaleString()) + dim(' (UTC-based)')
                    : red('(invalid expression)')),
        )
    })

// ─── schedule (container) ────────────────────────────────────────────────────

export const scheduleCmd = app
    .sub('schedule')
    .meta({ description: 'Manage the automated backup schedule' })
    .command(registerCmd)
    .command(unregisterCmd)
    .command(statusCmd)
