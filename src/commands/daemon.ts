import { appendFile } from 'node:fs/promises'

import { dataDir } from '@crustjs/store'
import { join } from 'pathe'

import { bekkCore } from '#bekk-core'
import { backupAllApps, formatAppListSummary } from '#lib/apps'
import { withRepoAuth, unwrapCoreResult } from '#lib/core-helpers'
import { fmtErr } from '#lib/error'
import { getAppListsDir } from '#lib/paths'
import { bold, cyan, dim, green, red, yellow, writeString } from '#lib/ui'

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
    try {
        await withRepoAuth(async (cfg, password) => {
            if (cfg.sourcePaths.length === 0) {
                await appendLog(logPath, 'ERROR', 'No source paths configured')
                return
            }

            const appListsDir = getAppListsDir()
            try {
                const result = await backupAllApps(appListsDir)
                await appendLog(
                    logPath,
                    'INFO',
                    `App lists saved (${formatAppListSummary(result)})`,
                )
            } catch (err) {
                await appendLog(logPath, 'ERROR', 'App list backup failed: ' + fmtErr(err))
            }

            const sources = [...cfg.sourcePaths, appListsDir]
            const data = unwrapCoreResult(
                await bekkCore.backup(cfg.repoPath, password, sources, false, undefined),
            )
            const snapshotId = data?.snapshot_id ?? 'unknown'
            await appendLog(logPath, 'INFO', `Backup complete — snapshot ${snapshotId.slice(0, 8)}`)
        })
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await appendLog(logPath, 'ERROR', msg)
    }
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

        writeString('')
        writeString(green('✓ ' + bold('bekk daemon started')))
        writeString(dim('  Schedule:  ') + cyan(cfg.cronSchedule))
        writeString(dim('  Next run:  ') + cyan(next.toLocaleString()))
        writeString(dim('  Log file:  ') + dim(logPath))
        writeString('')
        writeString(yellow('Press Ctrl+C to stop.'))
        writeString('')

        await appendLog(logPath, 'INFO', `Daemon started — schedule: ${cfg.cronSchedule}`)

        // Register in-process cron job
        Bun.cron(cfg.cronSchedule, async () => {
            const now = new Date().toISOString()
            writeString(`[${now}] Running scheduled backup...`)
            try {
                await runBackupCycle(logPath)
                const nextRun = Bun.cron.parse(cfg.cronSchedule)
                if (nextRun) {
                    writeString(
                        green('Backup complete.') + dim(`  Next run: ${nextRun.toLocaleString()}`),
                    )
                }
            } catch (err) {
                const msg = fmtErr(err)
                writeString(red('Backup error: ') + msg)
                await appendLog(logPath, 'ERROR', 'Unhandled error: ' + msg)
            }
        })

        // Keep process alive indefinitely
        await new Promise<never>(() => {})
    })
