import { commandValidator, flag } from '@crustjs/validate'
import { t as styledT, dim as otuiDim } from '@opentui/core'
import { z } from 'zod'

import { resolveSafeAppListPath } from '#lib/apps/provider-id'
import { formatError } from '#lib/error'
import { getAppListsDir } from '#lib/paths'
import { getEnabledBackends } from '#lib/sync/backends'
import type { App, SyncData } from '#lib/types'
import { dim, select, createTaskList, writeScrollback, writeString } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

export const writePulledAppLists = async (
    appListsDir: string,
    appLists: Record<string, App[] | null>,
): Promise<number> => {
    let fileCount = 0
    for (const [providerId, apps] of Object.entries(appLists)) {
        if (apps === null) continue

        await Bun.write(
            resolveSafeAppListPath(appListsDir, providerId),
            JSON.stringify(apps, null, 2),
        )
        fileCount++
    }
    return fileCount
}

export const pullCmd = app
    .sub('pull')
    .meta({ description: 'Pull config and app lists from a sync backend' })
    .flags({
        backend: flag(
            z
                .string()
                .optional()
                .describe('Pull from a specific backend by name (e.g. gist, work-r2)'),
            { short: 'b', type: 'string' },
        ),
        from: flag(
            z.string().optional().describe('Identifier override (Gist ID/URL or S3 object key)'),
            { short: 'f', type: 'string' },
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const allBackends = await getEnabledBackends()

            if (allBackends.length === 0) {
                writeString(
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
                writeString(`No backend named "${flags.backend}" is enabled.`)
                process.exitCode = 1
                return
            }

            const taskList = await createTaskList()
            const pullTask = taskList.add(`Pull from ${backend.label}`)
            taskList.update(pullTask, 'running')

            let syncData: SyncData | undefined

            try {
                syncData = await backend.pull(flags.from)
                taskList.update(pullTask, 'success')
            } catch (err) {
                taskList.update(pullTask, 'error', formatError(err))
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
            taskList.update(writeTask, 'running')
            try {
                await configStore.write(syncData.config)

                const appListsDir = getAppListsDir()
                const fileCount = await writePulledAppLists(appListsDir, syncData.appLists)
                taskList.update(writeTask, 'success', `${fileCount} app list(s)`)
            } catch (err) {
                taskList.update(writeTask, 'error', formatError(err))
                taskList.finish()
                process.exitCode = 1
                return
            }

            taskList.finish()
            writeScrollback(
                styledT`${otuiDim('  Run `bekk config show` to verify the loaded settings.')}`,
            )
        }),
    )
