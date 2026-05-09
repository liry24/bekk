import { readdir } from 'node:fs/promises'

import { spinner } from '@crustjs/progress'
import { confirm } from '@crustjs/prompts'
import { bold, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { backupAllApps } from '#lib/apps'
import { fmtErr } from '#lib/error'
import { getAppListsDir } from '#lib/paths'
import { getEnabledBackends } from '#lib/sync/backends'
import type { App, SyncData } from '#lib/types'

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

                await spinner({
                    message: 'Loading local app lists...',
                    task: async ({ updateMessage }) => {
                        const parts: string[] = []
                        for (const [providerId, apps] of Object.entries(appLists)) {
                            if (apps !== null) parts.push(`${providerId}: ${apps.length}`)
                        }
                        updateMessage('Local app lists loaded: ' + dim(parts.join(', ')))
                    },
                })
            } else {
                const shouldBackup = await confirm({
                    message: 'No local app lists found. Run backup now?',
                    default: true,
                })

                if (shouldBackup) {
                    await spinner({
                        message: 'Saving app lists...',
                        task: async ({ updateMessage }) => {
                            const result = await backupAllApps(appListsDir)
                            syncData = { config: cfg, appLists: result }
                            const parts: string[] = []

                            for (const [providerId, apps] of Object.entries(result)) {
                                if (apps !== null) parts.push(`${providerId}: ${apps.length}`)
                            }

                            updateMessage('App lists saved: ' + dim(parts.join(', ')))
                        },
                    })
                } else {
                    syncData = { config: cfg, appLists: {} }
                    console.log(dim('Skipping app list backup. Pushing config only.'))
                }
            }

            const allBackends = await getEnabledBackends()
            const backends = flags.backend
                ? allBackends.filter((b) => b.label === flags.backend)
                : allBackends

            if (backends.length === 0) {
                if (flags.backend) {
                    consola.error(`No backend named "${flags.backend}" is enabled.`)
                } else {
                    consola.warn(
                        'No sync backends are enabled. ' +
                            dim('Run `bekk init` or `bekk gist login` to set one up.'),
                    )
                }
                process.exitCode = 1
                return
            }

            let anyFailed = false
            for (const backend of backends) {
                let result = ''
                try {
                    await spinner({
                        message: `Pushing to ${backend.label}...`,
                        task: async ({ updateMessage }) => {
                            result = await backend.push(syncData!)
                            updateMessage(green(bold(`Pushed to ${backend.label}`)))
                        },
                    })
                    console.log(dim(`  ${result}`))
                } catch (err) {
                    consola.error(red(`Push to ${backend.label} failed: `) + fmtErr(err))
                    anyFailed = true
                }
            }

            if (anyFailed) process.exitCode = 1
        }),
    )
