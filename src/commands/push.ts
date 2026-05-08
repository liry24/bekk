import { spinner } from '@crustjs/progress'
import { dataDir } from '@crustjs/store'
import { bold, dim, green, link, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { backupApps } from '#lib/apps'
import { getEnabledBackends } from '#lib/sync'
import type { SyncData } from '#lib/types'

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
            const appListsDir = join(dataDir('bekk'), 'app-lists')
            let syncData: SyncData | null = null

            await spinner({
                message: 'Saving app lists...',
                task: async ({ updateMessage }) => {
                    const { scoop, winget } = await backupApps(
                        appListsDir,
                        cfg.wingetIncludeSources,
                    )
                    syncData = { config: cfg, appLists: { scoop, winget } }
                    const parts: string[] = []

                    if (scoop !== null) parts.push(`Scoop: ${scoop.length}`)
                    parts.push(`Winget: ${winget.length}`)

                    updateMessage('App lists saved: ' + dim(parts.join(', ')))
                },
            })

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
                            updateMessage(
                                green(bold(`Pushed to ${backend.label}`)) +
                                    ' ' +
                                    link(dim(result), result),
                            )
                        },
                    })
                } catch (err) {
                    consola.error(
                        red(`Push to ${backend.label} failed: `) +
                            (err instanceof Error ? err.message : String(err)),
                    )
                    anyFailed = true
                }
            }

            if (anyFailed) process.exitCode = 1
        }),
    )
