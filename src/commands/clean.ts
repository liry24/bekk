import { commandValidator, flag } from '@crustjs/validate'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import { withRepoAuth, unwrapCoreResult } from '#lib/core-helpers'
import {
    ansiToStyledText,
    bold,
    confirm,
    createTaskList,
    dim,
    drawPanel,
    getRenderer,
    red,
    writeScrollback,
    writeString,
    yellow,
} from '#lib/ui'

import { app } from '../app'

export const cleanCmd = app
    .sub('clean')
    .meta({ description: 'Prune orphaned data, check repository, and repair index' })
    .flags({
        'dry-run': flag(
            z
                .boolean()
                .default(false)
                .describe('Dry run — preview prune results without making changes'),
            { short: 'd' },
        ),
        'instant-delete': flag(
            z
                .boolean()
                .default(false)
                .describe('Delete unreferenced pack files immediately instead of marking them'),
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            let instantDelete = flags['instant-delete']
            if (!flags['dry-run'] && !instantDelete) {
                const confirmed = await confirm({
                    message:
                        'Enable instant-delete? ' +
                        yellow('(Warning: unsafe if repository is accessed by parallel processes)'),
                    default: false,
                    active: 'Yes  (instant delete)',
                    inactive: 'No  (mark for deletion)',
                })
                instantDelete = confirmed
            }

            const r = await getRenderer()
            writeScrollback(ansiToStyledText(dim('Cleaning repository...')))
            await r.idle()
            const taskList = await createTaskList()
            const pruneTask = taskList.add('Prune orphaned data')
            const checkTask = taskList.add('Check repository')
            const repairTask = taskList.add('Repair index')

            try {
                await withRepoAuth(async (cfg, password) => {
                    taskList.update(pruneTask, 'running')
                    taskList.update(checkTask, 'running')
                    taskList.update(repairTask, 'running')
                    const data = unwrapCoreResult(
                        await bekkCore.clean(
                            cfg.repoPath,
                            password,
                            flags['dry-run'],
                            instantDelete,
                        ),
                    )

                    // Prune result
                    const pruneData = data.prune
                    if (pruneData) {
                        if (pruneData.ok) {
                            taskList.update(pruneTask, 'success')
                        } else if (
                            pruneData.unreferenced_packs !== undefined &&
                            pruneData.unreferenced_size !== undefined
                        ) {
                            taskList.update(
                                pruneTask,
                                'success',
                                `${pruneData.unreferenced_packs} packs, ${pruneData.unreferenced_size} bytes unreferenced`,
                            )
                        } else {
                            taskList.update(pruneTask, 'success')
                        }
                    } else {
                        taskList.update(pruneTask, 'error')
                    }

                    // Check result
                    const checkData = data.check
                    if (checkData === null) {
                        taskList.update(checkTask, 'success', 'skipped (dry run)')
                    } else if (checkData?.ok) {
                        taskList.update(checkTask, 'success', 'no errors')
                    } else {
                        const errorCount = checkData?.errors?.length ?? 0
                        taskList.update(checkTask, 'error', `${errorCount} error(s) found`)
                    }

                    // Repair result
                    const repairData = data.repair_index
                    if (repairData === null) {
                        taskList.update(repairTask, 'success', 'skipped (dry run)')
                    } else if (repairData?.ok) {
                        taskList.update(repairTask, 'success')
                    } else {
                        taskList.update(repairTask, 'error')
                    }

                    taskList.finish()

                    // Summary panel
                    const lines: string[] = []
                    if (pruneData && !pruneData.ok) {
                        lines.push(
                            `${bold('Prune preview:')} ${pruneData.unreferenced_packs ?? 0} unreferenced pack(s), ${pruneData.unreferenced_size ?? 0} byte(s)`,
                        )
                    }
                    if (checkData && checkData.errors && checkData.errors.length > 0) {
                        lines.push(`${bold('Check errors:')}`)
                        for (const err of checkData.errors.slice(0, 10)) {
                            lines.push(`  [${err.level}] ${err.message}`)
                        }
                        if (checkData.errors.length > 10) {
                            lines.push(dim(`  ... and ${checkData.errors.length - 10} more`))
                        }
                    }
                    if (lines.length > 0) {
                        writeString('')
                        await drawPanel(lines, {
                            title: flags['dry-run'] ? 'Dry Run Summary' : 'Clean Summary',
                        })
                    }

                    if (!flags['dry-run'] && checkData && !checkData.ok) {
                        writeString('')
                        writeString(
                            yellow('Repository check found errors. Review the output above.'),
                        )
                    }
                })
            } catch (err) {
                taskList.update(pruneTask, 'error')
                taskList.update(checkTask, 'error')
                taskList.update(repairTask, 'error')
                taskList.finish()
                writeString(
                    red('Clean failed:') + ' ' + (err instanceof Error ? err.message : String(err)),
                )
                return
            }
        }),
    )
