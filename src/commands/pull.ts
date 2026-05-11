import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { fmtErr } from '#lib/error'
import { getAppListsDir } from '#lib/paths'
import { getEnabledBackends } from '#lib/sync/backends'
import type { SyncData } from '#lib/types'
import { dim, select, createTaskList } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

export const pullCmd = app
    .sub('pull')
    .meta({ description: 'Pull config and app lists from a sync backend' })
    .flags({
        backend: flag(
            z
                .string()
                .optional()
                .describe('Pull from a specific backend by name (e.g. gist, work-r2)'),
            { short: 'b' },
        ),
        from: flag(
            z.string().optional().describe('Identifier override (Gist ID/URL or S3 object key)'),
            { short: 'f' },
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const allBackends = await getEnabledBackends()

            if (allBackends.length === 0) {
                consola.error(
                    'No sync backends are enabled. ' +
                        dim('Run `bekk init` or `bekk gist login` to set one up.'),
                )
                process.exitCode = 1
                return
            }

            // Determine which backend to pull from
            let backend = flags.backend
                ? allBackends.find((b) => b.label === flags.backend)
                : allBackends.length === 1
                  ? allBackends[0]
                  : undefined

            if (!backend && !flags.backend) {
                // Multiple backends: ask user
                const choice = await select<string>({
                    message: 'Pull from which backend?',
                    choices: allBackends.map((b) => ({ label: b.label, value: b.label })),
                })
                backend = allBackends.find((b) => b.label === choice)
            }

            if (!backend) {
                consola.error(`No backend named "${flags.backend}" is enabled.`)
                process.exitCode = 1
                return
            }

            const taskList = await createTaskList()
            const pullTask = taskList.add(`Pull from ${backend.label}`)

            let syncData: SyncData | undefined

            try {
                syncData = await backend.pull(flags.from)
                taskList.update(pullTask, 'success')
            } catch (err) {
                taskList.update(pullTask, 'error', fmtErr(err))
                taskList.finish()
                process.exitCode = 1
                return
            }

            if (!syncData) {
                taskList.update(pullTask, 'error', 'no data received')
                taskList.finish()
                process.exitCode = 1
                return
            }

            // Write config locally
            const writeTask = taskList.add('Write local files')
            try {
                await configStore.write(syncData.config)

                const appListsDir = getAppListsDir()
                let fileCount = 0
                for (const [providerId, apps] of Object.entries(syncData.appLists)) {
                    if (apps !== null) {
                        await Bun.write(
                            join(appListsDir, `${providerId}.json`),
                            JSON.stringify(apps, null, 2),
                        )
                        fileCount++
                    }
                }
                taskList.update(writeTask, 'success', `${fileCount} app list(s)`)
            } catch (err) {
                taskList.update(writeTask, 'error', fmtErr(err))
                taskList.finish()
                process.exitCode = 1
                return
            }

            taskList.finish()
            console.log(dim('  Run `bekk config show` to verify the loaded settings.'))
        }),
    )
