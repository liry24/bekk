import { spinner } from '@crustjs/progress'
import { input } from '@crustjs/prompts'
import { bold, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { app } from '../app'
import { bekkCore } from '../lib/bekk-core'
import { resolveRepoPassword } from '../lib/secrets'
import { configStore } from '../store'

export const restoreCmd = app
    .sub('restore')
    .meta({ description: 'Restore files from the backup repository' })
    .flags({
        snapshot: flag(
            z.string().default('latest').describe('Snapshot ID to restore (default: latest)'),
            { short: 's' },
        ),
        target: flag(z.string().optional().describe('Destination path for restored files'), {
            short: 't',
        }),
        'dry-run': flag(
            z.boolean().default(false).describe('Dry run — preview without writing files'),
            { short: 'd' },
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const cfg = await configStore.read()

            if (!cfg.repoPath) {
                consola.error('Backup destination is not configured. Run `bekk init` first.')
                process.exit(1)
            }

            const password = await resolveRepoPassword()
            if (!password) {
                consola.error(
                    'Backup password is not stored. Run `bekk init` or set BEKK_REPO_PASSWORD.',
                )
                process.exit(1)
            }

            const target =
                flags.target ??
                (await input({
                    message: 'Restore target path',
                    validate: (v) => (v.trim() ? true : 'Target path is required'),
                }))

            const snapshotLabel =
                flags.snapshot === 'latest' ? 'latest snapshot' : `snapshot ${dim(flags.snapshot)}`
            const label = `${snapshotLabel} → ${dim(target)}`

            try {
                await spinner({
                    message: `Restoring ${label}${flags['dry-run'] ? dim(' [dry run]') : ''}`,
                    task: async ({ updateMessage }) => {
                        const result = await bekkCore.restore(
                            cfg.repoPath,
                            password,
                            target,
                            flags.snapshot,
                            flags['dry-run'],
                        )
                        if (result.status === 'error') throw new Error(result.message)
                        updateMessage(`Restore complete: ${label}`)
                    },
                })

                if (flags['dry-run']) {
                    consola.success(green('[dry run] Restore simulation complete.'))
                } else {
                    consola.success(green(bold('Restore complete')) + `  → ${dim(target)}`)
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                if (/No snapshots found/i.test(message)) {
                    consola.error(red('Restore failed:'), 'No snapshots found in this repository.')
                    consola.info(dim('Run `bekk backup` first, then retry `bekk restore`.'))
                    return
                }
                consola.error(red('Restore failed: ') + message)
                return
            }
        }),
    )
