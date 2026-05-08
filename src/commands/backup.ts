import { dataDir } from '@crustjs/store'
import { bold, cyan, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import { join } from 'pathe'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import type { ProgressEvent } from '#bekk-core'
import { backupAllApps, formatAppListSummary, getAvailableProviders } from '#lib/apps'
import { resolveRepoPassword } from '#lib/secrets'
import { createTaskList, createRichProgress, drawPanel } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

export const backupCmd = app
    .sub('backup')
    .meta({ description: 'Run local data backup and app list backup' })
    .flags({
        'dry-run': flag(
            z
                .boolean()
                .default(false)
                .describe('Dry run — preview changes without writing to the repository'),
            { short: 'd' },
        ),
        tag: flag(z.string().optional().describe('Tag to attach to the snapshot'), { short: 't' }),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const cfg = await configStore.read()

            if (!cfg.repoPath) {
                console.error(red('Backup destination is not configured. Run `bekk init` first.'))
                return
            }
            if (!cfg.sourcePaths.length) {
                console.error(
                    red('No source paths configured. Run `bekk config` to add source paths.'),
                )
                return
            }

            const password = await resolveRepoPassword()
            if (!password) {
                console.error(red('Backup password is not stored. Run `bekk config`.'))
                return
            }

            // ── Sources panel ───────────────────────────────────────────────────
            const sourceLines = cfg.sourcePaths.map((s) => `${dim('•')} ${cyan(s)}`)
            if (flags['dry-run']) sourceLines.unshift(dim('[dry run]'))
            drawPanel(sourceLines, { title: 'bekk backup' })

            // ── App list backup ────────────────────────────────────────────────
            const appListsDir = join(dataDir('bekk'), 'app-lists')
            let appSummary = ''
            const taskList = createTaskList()
            const taskIds: Record<string, string> = {}

            for (const p of getAvailableProviders()) taskIds[p.id] = taskList.add(p.name)

            try {
                const result = await backupAllApps(
                    flags['dry-run'] ? undefined : appListsDir,
                    (providerId, state, count) => {
                        const taskId = taskIds[providerId]
                        if (!taskId) return
                        if (state === 'start') taskList.update(taskId, 'running')
                        else if (state === 'done')
                            taskList.update(taskId, 'success', `${count} apps`)
                        else if (state === 'error') taskList.update(taskId, 'error')
                    },
                )
                taskList.finish()
                appSummary = formatAppListSummary(result)
                console.log()
                console.log(`${green(bold('◉'))} App list backup  ${dim(appSummary)}`)
            } catch (err) {
                taskList.finish()
                console.warn(
                    dim('App list backup failed:') +
                        ' ' +
                        (err instanceof Error ? err.message : String(err)),
                )
            }

            // ── Repository backup ──────────────────────────────────────────────
            const sources = [...cfg.sourcePaths]
            const progress = createRichProgress({
                barWidth: 40,
                preparingTitle: 'Preparing repository backup...',
            })

            const handleProgress = (ev: ProgressEvent) => {
                const progressType = ev.progress_type ?? 'spinner'
                if (ev.action === 'set_length' && ev.length !== undefined)
                    progress.updatePhase(ev.phase, {
                        total: Number(ev.length),
                        progressType,
                    })
                else if (ev.action === 'inc' && ev.increment)
                    progress.updatePhase(ev.phase, {
                        increment: Number(ev.increment),
                        progressType,
                    })
                else if (ev.action === 'set_title' && ev.title)
                    progress.updatePhase(ev.phase, { title: ev.title, progressType })
                else if (ev.action === 'finish')
                    progress.updatePhase(ev.phase, { finished: true, progressType })
            }

            let snapshotId = ''
            progress.render()
            try {
                const result = await bekkCore.backupStream(
                    cfg.repoPath,
                    password,
                    sources,
                    { onProgress: handleProgress },
                    flags['dry-run'],
                    flags.tag,
                    cfg.snapshotLimit,
                )
                progress.render()
                progress.finish()

                if (result.status === 'error') throw new Error(result.message)
                if (result.status === 'ok' && 'data' in result && result.data) {
                    snapshotId = result.data.snapshot_id
                }
            } catch (err) {
                progress.finish()
                console.error(
                    red('Backup failed:'),
                    err instanceof Error ? err.message : String(err),
                )
                return
            }

            // ── Summary panel ──────────────────────────────────────────────────
            const summaryLines = [
                `${bold('Snapshot:')} ${flags['dry-run'] ? dim('(not created)') : green(snapshotId ? snapshotId.slice(0, 8) : dim('—'))}`,
                `${bold('Sources:')}  ${sources.length} path(s)`,
            ]
            if (appSummary) summaryLines.push(`${bold('Apps:')}     ${appSummary}`)
            console.log()
            drawPanel(summaryLines, {
                title: flags['dry-run'] ? 'Dry Run Complete' : 'Backup Complete',
            })
        }),
    )
