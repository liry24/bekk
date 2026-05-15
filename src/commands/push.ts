import { readdir } from 'node:fs/promises'

import { commandValidator, flag } from '@crustjs/validate'
import { t as styledT, dim as otuiDim } from '@opentui/core'
import { join } from 'pathe'
import { z } from 'zod'

import { backupAllApps } from '#lib/apps'
import { formatError } from '#lib/error'
import { getAppListsDir } from '#lib/paths'
import { getEnabledBackends } from '#lib/sync/backends'
import type { App, SyncData } from '#lib/types'
import { dim, confirm, createTaskList, writeScrollback, writeString } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

export const pushCmd = app
    .sub('push')
    .meta({ description: 'Push config and app lists to all enabled sync backends' })
    .flags({
        backend: flag(
            z
                .string()
                .optional()
                .describe('Push to a specific backend by name (e.g. gist, work-r2)'),
            { short: 'b' },
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const cfg = await configStore.read()

            // Collect current app lists
            const appListsDir = getAppListsDir()
            let syncData: SyncData | null = null

            const taskList = await createTaskList()

            const existingFiles = await readdir(appListsDir).catch(() => [] as string[])
            const jsonFiles = existingFiles.filter((f) => f.endsWith('.json'))

            if (jsonFiles.length > 0) {
                const appLists: Record<string, App[] | null> = {}
                for (const file of jsonFiles) {
                    const providerId = file.slice(0, -5)
                    try {
                        const apps = (await Bun.file(join(appListsDir, file)).json()) as App[]
                        appLists[providerId] = apps
                    } catch {
                        appLists[providerId] = null
                    }
                }
                syncData = { config: cfg, appLists }

                const parts: string[] = []
                for (const [providerId, apps] of Object.entries(appLists)) {
                    if (apps !== null) parts.push(`${providerId}: ${apps.length}`)
                }
                taskList.add('Load local app lists', parts.join(', '))
            } else {
                const shouldBackup = await confirm({
                    message: 'No local app lists found. Run backup now?',
                    default: true,
                })

                if (shouldBackup) {
                    const backupTask = taskList.add('Backup app lists')
                    taskList.update(backupTask, 'running')
                    try {
                        const result = await backupAllApps(appListsDir)
                        syncData = { config: cfg, appLists: result }
                        const parts: string[] = []
                        for (const [providerId, apps] of Object.entries(result)) {
                            if (apps !== null) parts.push(`${providerId}: ${apps.length}`)
                        }
                        taskList.update(backupTask, 'success', parts.join(', '))
                    } catch (err) {
                        taskList.update(backupTask, 'error', formatError(err))
                        syncData = { config: cfg, appLists: {} }
                    }
                } else {
                    syncData = { config: cfg, appLists: {} }
                    writeScrollback(
                        styledT`${otuiDim('Skipping app list backup. Pushing config only.')}`,
                    )
                }
            }

            const allBackends = await getEnabledBackends()
            const backends = flags.backend
                ? allBackends.filter((b) => b.label === flags.backend)
                : allBackends

            if (backends.length === 0) {
                if (flags.backend) {
                    writeString(`No backend named "${flags.backend}" is enabled.`)
                } else {
                    writeString(
                        'No sync backends are enabled. ' +
                            dim('Run `bekk init` or `bekk gist login` to set one up.'),
                    )
                }
                taskList.finish()
                process.exitCode = 1
                return
            }

            const backendTasks: Record<string, string> = {}
            for (const b of backends) {
                backendTasks[b.label] = taskList.add(`Push to ${b.label}`)
            }

            const results: Record<string, string> = {}
            let anyFailed = false
            for (const b of backends) {
                const taskId = backendTasks[b.label]!
                taskList.update(taskId, 'running')
                try {
                    const result = await b.push(syncData!)
                    results[b.label] = result
                    taskList.update(taskId, 'success')
                } catch (err) {
                    taskList.update(taskId, 'error', formatError(err))
                    anyFailed = true
                }
            }

            taskList.finish()
            for (const [label, result] of Object.entries(results)) {
                writeScrollback(styledT`${otuiDim(`  ${label}: ${result}`)}`)
            }
            if (anyFailed) process.exitCode = 1
        }),
    )
