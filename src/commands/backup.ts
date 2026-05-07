import { spinner } from '@crustjs/progress'
import { dataDir } from '@crustjs/store'
import { bold, cyan, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { app } from '../app'
import { backupApps, listScoop, listWinget } from '../lib/apps'
import { bekkCore } from '../lib/bekk-core'
import { resolveRepoPassword } from '../lib/secrets'
import { configStore } from '../store'

export const backupCmd = app
    .sub('backup')
    .meta({ description: 'Run local data backup and app list backup' })
    .flags({
        dryRun: flag(
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
                process.exit(1)
            }
            if (cfg.sourcePaths.length === 0) {
                consola.error(
                    'No source paths configured. Use `bekk config add <path>` to add one.',
                )
                process.exit(1)
            }

            const password = await resolveRepoPassword()
            if (!password) {
                consola.error(
                    'Backup password is not stored. Run `bekk init` or set BEKK_REPO_PASSWORD.',
                )
                process.exit(1)
            }

            // App list backup
            const appListsDir = join(dataDir('bekk'), 'app-lists')
            try {
                let summary = ''
                await spinner({
                    message: flags.dryRun ? 'Scanning installed apps...' : 'Saving app lists...',
                    task: async ({ updateMessage }) => {
                        const parts: string[] = []
                        if (flags.dryRun) {
                            const scoop = listScoop()
                            const winget = listWinget(cfg.wingetIncludeSources)
                            if (scoop !== null) parts.push(`Scoop: ${scoop.length} apps`)
                            parts.push(`Winget: ${winget.length} apps`)
                        } else {
                            const { scoop, winget } = await backupApps(
                                appListsDir,
                                cfg.wingetIncludeSources,
                            )
                            if (scoop !== null) parts.push(`Scoop: ${scoop.length} apps`)
                            parts.push(`Winget: ${winget.length} apps`)
                        }
                        summary = parts.join('  ')
                        updateMessage(
                            flags.dryRun
                                ? dim('[dry run] ') + `App list backup would save  —  ${summary}`
                                : `App list backup complete  —  ${summary}`,
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
                        if (flags.dryRun) {
                            updateMessage(`${dim('[dry run]')} Backing up: ${label}`)
                        }
                        const result = await bekkCore.backup(
                            cfg.repoPath,
                            password,
                            sources,
                            flags.dryRun,
                            flags.tag,
                        )
                        if (result.status === 'error') throw new Error(result.message)
                        if (result.status === 'ok' && 'data' in result && result.data) {
                            snapshotId = result.data.snapshot_id
                            updateMessage(
                                `Backup complete  —  snapshot ${dim(snapshotId.slice(0, 8))}`,
                            )
                        }
                    },
                })
                if (snapshotId) {
                    consola.success(
                        green(bold('Backup complete')) +
                            `  snapshot ${dim(snapshotId.slice(0, 8))}`,
                    )
                } else if (flags.dryRun) {
                    consola.success(green('[dry run] Backup simulation complete.'))
                }
            } catch (err) {
                consola.error(
                    red('Backup failed: ') + (err instanceof Error ? err.message : String(err)),
                )
                process.exitCode = 1
                return
            }
        }),
    )
