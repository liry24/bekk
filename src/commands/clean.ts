import { confirm, spinner } from '@crustjs/prompts'
import { bold, dim, red, yellow } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import { resolveRepoPassword } from '#lib/secrets'
import { createTaskList, drawPanel } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

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
            const cfg = await configStore.read()

            if (!cfg.repoPath) {
                console.error(red('Backup destination is not configured. Run `bekk init` first.'))
                return
            }

            const password = await resolveRepoPassword()
            if (!password) {
                console.error(red('Backup password is not stored. Run `bekk config`.'))
                return
            }

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

            const taskList = createTaskList()
            const pruneTask = taskList.add('Prune orphaned data')
            const checkTask = taskList.add('Check repository')
            const repairTask = taskList.add('Repair index')

            let result: import('#bekk-core').CoreResult<{
                prune: {
                    ok?: boolean
                    unreferenced_packs?: number
                    unreferenced_size?: number
                }
                check: { ok?: boolean; errors?: { level: string; message: string }[] } | null
                repair_index: { ok?: boolean } | null
            }>

            await spinner({
                message: 'Cleaning repository...',
                task: async () => {
                    result = await bekkCore.clean(
                        cfg.repoPath,
                        password,
                        flags['dry-run'],
                        instantDelete,
                    )
                },
            })

            if (result!.status === 'error') {
                taskList.update(pruneTask, 'error')
                taskList.update(checkTask, 'error')
                taskList.update(repairTask, 'error')
                taskList.finish()
                console.error(red('Clean failed:'), result!.message)
                return
            }

            const data = 'data' in result! ? result!.data : null

            // Prune result
            const pruneData = data?.prune
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
            const checkData = data?.check
            if (checkData === null) {
                taskList.update(checkTask, 'success', 'skipped (dry run)')
            } else if (checkData?.ok) {
                taskList.update(checkTask, 'success', 'no errors')
            } else {
                const errorCount = checkData?.errors?.length ?? 0
                taskList.update(checkTask, 'error', `${errorCount} error(s) found`)
            }

            // Repair result
            const repairData = data?.repair_index
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
                console.log()
                drawPanel(lines, { title: flags['dry-run'] ? 'Dry Run Summary' : 'Clean Summary' })
            }

            if (!flags['dry-run'] && checkData && !checkData.ok) {
                console.log()
                consola.warn(yellow('Repository check found errors. Review the output above.'))
            }
        }),
    )
