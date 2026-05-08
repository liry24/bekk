import { homedir } from 'node:os'

import { confirm, input } from '@crustjs/prompts'
import { bold, cyan, dim, green, red, yellow } from '@crustjs/style'
import { promptValidator } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { isAdmin } from '#lib/admin'

import { app } from '../app'
import { configStore } from '../store'

const TASK_NAME = 'BekkDaemon'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getBinaryPath = () => process.execPath

// Windows ──────────────────────────────────────────────────────────────────────

const registerWindows = (exePath: string, admin: boolean) => {
    const trigger = admin ? '/sc onstart' : '/sc onlogon'
    const ruParam = admin ? '/ru SYSTEM' : ''
    const args = [
        'schtasks',
        '/create',
        '/tn',
        TASK_NAME,
        '/tr',
        `"${exePath}" daemon`,
        ...trigger.split(' '),
        ...(ruParam ? ruParam.split(' ') : []),
        '/f',
    ]
    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) {
        const err = new TextDecoder().decode(result.stderr).trim()
        throw new Error(`schtasks failed: ${err}`)
    }
}

const unregisterWindows = () => {
    const result = Bun.spawnSync(['schtasks', '/delete', '/tn', TASK_NAME, '/f'], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    if (result.exitCode !== 0) {
        const err = new TextDecoder().decode(result.stderr).trim()
        // Treat "not found" as success
        if (!err.includes('not found') && !err.includes('ERROR: The system cannot find'))
            throw new Error(`schtasks failed: ${err}`)
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
        const r = Bun.spawnSync(['launchctl', 'load', plistPath], {
            stdout: 'pipe',
            stderr: 'pipe',
        })
        if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr).trim())
    } else {
        const uid = String(process.getuid?.() ?? 501)
        const r = Bun.spawnSync(['launchctl', 'bootstrap', `gui/${uid}`, plistPath], {
            stdout: 'pipe',
            stderr: 'pipe',
        })
        if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr).trim())
    }
}

const unregisterMacOS = async (admin: boolean) => {
    const plistPath = getMacOSPlistPath(admin)
    if (!(await Bun.file(plistPath).exists())) return

    if (admin) Bun.spawnSync(['launchctl', 'unload', plistPath], { stdout: 'pipe', stderr: 'pipe' })
    else {
        const uid = String(process.getuid?.() ?? 501)
        Bun.spawnSync(['launchctl', 'bootout', `gui/${uid}`, plistPath], {
            stdout: 'pipe',
            stderr: 'pipe',
        })
    }
    await Bun.file(plistPath)
        .text()
        .then(() => {
            // Remove the plist file via overwrite with empty (no delete API)
            return Bun.spawnSync(['rm', '-f', plistPath], { stdout: 'pipe', stderr: 'pipe' })
        })
        .catch(() => {})
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
    Bun.spawnSync(['mkdir', '-p', serviceDir], { stdout: 'pipe', stderr: 'pipe' })
    await Bun.write(servicePath, buildLinuxUnit(exePath))

    const systemctlArgs = admin
        ? ['systemctl', 'enable', '--now', 'bekk-daemon']
        : ['systemctl', '--user', 'enable', '--now', 'bekk-daemon']
    const r = Bun.spawnSync(systemctlArgs, { stdout: 'pipe', stderr: 'pipe' })
    if (r.exitCode !== 0) {
        const err = new TextDecoder().decode(r.stderr).trim()
        throw new Error(`systemctl failed: ${err}`)
    }
}

const unregisterLinux = async (admin: boolean) => {
    const stopArgs = admin
        ? ['systemctl', 'disable', '--now', 'bekk-daemon']
        : ['systemctl', '--user', 'disable', '--now', 'bekk-daemon']
    Bun.spawnSync(stopArgs, { stdout: 'pipe', stderr: 'pipe' })

    const servicePath = getLinuxServicePath(admin)
    Bun.spawnSync(['rm', '-f', servicePath], { stdout: 'pipe', stderr: 'pipe' })
}

// ─── schedule register ────────────────────────────────────────────────────────

const registerCmd = app
    .sub('schedule')
    .sub('register')
    .meta({ description: 'Register bekk daemon as a startup service and set cron schedule' })
    .run(async () => {
        const admin = isAdmin()
        const exePath = getBinaryPath()

        console.log(bold(cyan('=== bekk Schedule Registration ===')))
        console.log()
        if (admin) console.log(green('  [Admin] Daemon will run as a system service.'))
        else console.log(yellow('  [User] Daemon will run as the current user.'))

        console.log()

        const cronExpr = await input({
            message: 'Cron expression (e.g. "0 2 * * *" for daily at 02:00 UTC)',
            validate: promptValidator(
                z.string().refine((v) => Bun.cron.parse(v.trim()) !== null, {
                    message: 'Invalid cron expression',
                }),
            ),
        })

        const trimmedExpr = cronExpr.trim()
        const next = Bun.cron.parse(trimmedExpr)!

        console.log()
        console.log(dim('  Binary:   ') + dim(exePath))
        console.log(dim('  Schedule: ') + cyan(trimmedExpr))
        console.log(dim('  Next run: ') + cyan(next.toLocaleString()) + dim(' (UTC-based)'))
        console.log()

        const ok = await confirm({ message: 'Register with these settings?', default: true })
        if (!ok) {
            console.log(dim('Cancelled.'))
            return
        }

        try {
            if (process.platform === 'win32') registerWindows(exePath, admin)
            else if (process.platform === 'darwin') await registerMacOS(exePath, admin)
            else await registerLinux(exePath, admin)
        } catch (err) {
            consola.error(
                red('Failed to register startup task: ') +
                    (err instanceof Error ? err.message : String(err)),
            )
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
    .run(async () => {
        const admin = isAdmin()

        const ok = await confirm({
            message: red('Remove bekk daemon startup service?'),
            default: false,
            active: 'Remove',
            inactive: 'Cancel',
        })
        if (!ok) {
            console.log(dim('Cancelled.'))
            return
        }

        try {
            if (process.platform === 'win32') unregisterWindows()
            else if (process.platform === 'darwin') await unregisterMacOS(admin)
            else await unregisterLinux(admin)
        } catch (err) {
            consola.error(
                red('Failed to remove startup task: ') +
                    (err instanceof Error ? err.message : String(err)),
            )
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
            consola.info('No schedule configured. Run ' + cyan('bekk schedule register') + '.')
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
