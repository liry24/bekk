import { spinner } from '@crustjs/progress'
import { select } from '@crustjs/prompts'
import { dataDir } from '@crustjs/store'
import { bold, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { getEnabledBackends } from '#lib/sync'
import type { SyncData } from '#lib/sync'

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

            let syncData: SyncData | undefined

            try {
                await spinner({
                    message: `Pulling from ${backend.label}...`,
                    task: async ({ updateMessage }) => {
                        syncData = await backend!.pull(flags.from)
                        updateMessage(
                            green(bold(`Config and app lists loaded from ${backend.label}.`)),
                        )
                    },
                })

                if (!syncData) {
                    consola.error(`Pull from ${backend.label} failed: no data received`)
                    process.exitCode = 1
                    return
                }

                // Write config locally
                await configStore.write(syncData.config)

                // Write app lists locally
                const appListsDir = join(dataDir('bekk'), 'app-lists')
                if (syncData.appLists.scoop !== null)
                    await Bun.write(
                        join(appListsDir, 'scoop.json'),
                        JSON.stringify(syncData.appLists.scoop, null, 2),
                    )

                await Bun.write(
                    join(appListsDir, 'winget.json'),
                    JSON.stringify(syncData.appLists.winget, null, 2),
                )
            } catch (err) {
                consola.error(
                    red(`Pull from ${backend.label} failed: `) +
                        (err instanceof Error ? err.message : String(err)),
                )
                process.exitCode = 1
                return
            }

            consola.log(dim('  Run `bekk config show` to verify the loaded settings.'))
        }),
    )
