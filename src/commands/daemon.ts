import { appendFile } from 'node:fs/promises'

import { dataDir } from '@crustjs/store'
import { bold, cyan, dim, green, red, yellow } from '@crustjs/style'
import consola from 'consola'
import { join } from 'pathe'

import { bekkCore } from '#bekk-core'
import { backupAllApps } from '#lib/apps'
import { cliLog } from '#lib/log'
import { resolveRepoPassword } from '#lib/secrets'

import { app } from '../app'
import { configStore } from '../store'

// Append a log entry to the daemon log file
const appendLog = async (logPath: string, level: 'INFO' | 'ERROR', message: string) => {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [${level}] ${message}\n`
    await appendFile(logPath, line)
}

// Run a single backup cycle (same logic as backupCmd but without interactive prompts)
const runBackupCycle = async (logPath: string) => {
    const cfg = await configStore.read()
    const password = await resolveRepoPassword()

    if (!cfg.repoPath || !password) {
        const msg = !cfg.repoPath ? 'Repository not configured' : 'Repository password not stored'
        await appendLog(logPath, 'ERROR', msg)
        return
    }

    if (cfg.sourcePaths.length === 0) {
        await appendLog(logPath, 'ERROR', 'No source paths configured')
        return
    }

    const appListsDir = join(dataDir('bekk'), 'app-lists')
    try {
        const result = await backupAllApps(appListsDir)
        const parts: string[] = []
        for (const [providerId, apps] of Object.entries(result)) {
            if (apps !== null) parts.push(`${providerId}:${apps.length}`)
        }
        await appendLog(logPath, 'INFO', `App lists saved (${parts.join(', ')})`)
    } catch (err) {
        await appendLog(
            logPath,
            'ERROR',
            'App list backup failed: ' + (err instanceof Error ? err.message : String(err)),
        )
    }

    const sources = [...cfg.sourcePaths, appListsDir]
    const result = await bekkCore.backup(cfg.repoPath, password, sources, false, undefined)

    if (result.status === 'error') {
        await appendLog(logPath, 'ERROR', 'Backup failed: ' + result.message)
        return
    }

    const snapshotId =
        result.status === 'ok' && 'data' in result && result.data
            ? result.data.snapshot_id
            : 'unknown'
    await appendLog(logPath, 'INFO', `Backup complete — snapshot ${snapshotId.slice(0, 8)}`)
}

export const daemonCmd = app
    .sub('daemon')
    .meta({ description: 'Run the backup daemon (stays resident, triggers via cron schedule)' })
    .run(async () => {
        const cfg = await configStore.read()
        const logPath = join(dataDir('bekk'), 'daemon.log')

        if (!cfg.cronSchedule) {
            throw new Error(
                'No cron schedule configured. Run ' + cyan('bekk schedule register') + ' first.',
            )
        }

        // Validate schedule using Bun.cron.parse
        const next = Bun.cron.parse(cfg.cronSchedule)
        if (next === null) {
            throw new Error(`Invalid cron expression: ${bold(cfg.cronSchedule)}`)
        }

        cliLog({
            messages: [
                green('✓ ' + bold('bekk daemon started')),
                dim('  Schedule:  ') + cyan(cfg.cronSchedule),
                dim('  Next run:  ') + cyan(next.toLocaleString()),
                dim('  Log file:  ') + dim(logPath),
                '',
                yellow('Press Ctrl+C to stop.'),
            ],
            padding: { side: 'bottom' },
        })

        await appendLog(logPath, 'INFO', `Daemon started — schedule: ${cfg.cronSchedule}`)

        // Register in-process cron job
        Bun.cron(cfg.cronSchedule, async () => {
            const now = new Date().toISOString()
            consola.info(`[${now}] Running scheduled backup...`)
            try {
                await runBackupCycle(logPath)
                const nextRun = Bun.cron.parse(cfg.cronSchedule)
                if (nextRun) {
                    consola.success(
                        green('Backup complete.') + dim(`  Next run: ${nextRun.toLocaleString()}`),
                    )
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                consola.error(red('Backup error: ') + msg)
                await appendLog(logPath, 'ERROR', 'Unhandled error: ' + msg)
            }
        })

        // Keep process alive indefinitely
        await new Promise<never>(() => {})
    })
