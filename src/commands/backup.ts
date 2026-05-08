import { spinner } from '@crustjs/progress'
import { dataDir } from '@crustjs/store'
import { bold, cyan, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import { backupApps, listScoop, listWinget } from '#lib/apps'
import { resolveRepoPassword } from '#lib/secrets'

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
                consola.error('Backup destination is not configured. Run `bekk init` first.')
                return
            }
            if (!cfg.sourcePaths.length) {
                consola.error('No source paths configured. Run `bekk config` to add source paths.')
                return
            }

            const password = await resolveRepoPassword()
            if (!password) {
                consola.error('Backup password is not stored. Run `bekk config`.')
                return
            }

            // App list backup
            const appListsDir = join(dataDir('bekk'), 'app-lists')
            try {
                let summary = ''
                await spinner({
                    message: flags['dry-run']
                        ? 'Scanning installed apps...'
                        : 'Saving app lists...',
                    task: async ({ updateMessage }) => {
                        const parts: string[] = []
                        if (flags['dry-run']) {
                            const scoop = listScoop()
                            const winget = listWinget(cfg.wingetIncludeSources)
                            if (scoop !== null) parts.push(`Scoop: ${scoop.length}`)
                            parts.push(`Winget: ${winget.length}`)
                        } else {
                            const { scoop, winget } = await backupApps(
                                appListsDir,
                                cfg.wingetIncludeSources,
                            )
                            if (scoop !== null) parts.push(`Scoop: ${scoop.length}`)
                            parts.push(`Winget: ${winget.length}`)
                        }
                        summary = parts.join('  ')
                        updateMessage(
                            flags['dry-run']
                                ? dim('[dry run] ') + `App list backup would save: ${summary}`
                                : `App list backup complete: ${dim(summary)}`,
                        )
                    },
                })
            } catch (err) {
                consola.warn(
                    'App list backup failed: ' + (err instanceof Error ? err.message : String(err)),
                )
            }

            // Local data backup via bekk-core / rustic
            const sources = [...cfg.sourcePaths]
            const label = sources.map((s) => cyan(s)).join(', ')
            console.log()

            let snapshotId = ''
            try {
                await spinner({
                    message: `Backing up: ${label}`,
                    task: async ({ updateMessage }) => {
                        if (flags['dry-run'])
                            updateMessage(`${dim('[dry run]')} Backing up: ${label}`)

                        const result = await bekkCore.backup(
                            cfg.repoPath,
                            password,
                            sources,
                            flags['dry-run'],
                            flags.tag,
                        )

                        if (result.status === 'error') throw new Error(result.message)
                        if (result.status === 'ok' && 'data' in result && result.data) {
                            snapshotId = result.data.snapshot_id
                            if (snapshotId)
                                updateMessage(
                                    green(bold('Backup complete')) +
                                        `  snapshot ${dim(snapshotId.slice(0, 8))}`,
                                )
                            else if (flags['dry-run'])
                                updateMessage(green('[dry run] Backup simulation complete.'))
                        }
                    },
                })
            } catch (err) {
                consola.error(
                    red('Backup failed:'),
                    err instanceof Error ? err.message : String(err),
                )
                return
            }
        }),
    )
