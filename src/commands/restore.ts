import { commandValidator, flag } from '@crustjs/validate/zod'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import { withRepoAuth, unwrapCoreResult } from '#lib/core-helpers'
import { fmtErr } from '#lib/error'
import { bold, dim, green, red, input, spinner, writeString } from '#lib/ui'

import { app } from '../app'

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
            try {
                await withRepoAuth(async (cfg, password) => {
                    const target =
                        flags.target ??
                        (await input({
                            message: 'Restore target path',
                            validate: (v) => (v.trim() ? true : 'Target path is required'),
                        }))

                    const snapshotLabel =
                        flags.snapshot === 'latest'
                            ? 'latest snapshot'
                            : `snapshot ${dim(flags.snapshot)}`
                    const label = `${snapshotLabel} → ${dim(target)}`

                    await spinner({
                        message: `Restoring ${label}${flags['dry-run'] ? dim(' [dry run]') : ''}`,
                        task: async ({ updateMessage }) => {
                            unwrapCoreResult(
                                await bekkCore.restore(
                                    cfg.repoPath,
                                    password,
                                    target,
                                    flags.snapshot,
                                    flags['dry-run'],
                                ),
                            )
                            updateMessage(`Restore complete: ${label}`)
                        },
                    })

                    if (flags['dry-run']) {
                        writeString(green('[dry run] Restore simulation complete.'))
                    } else {
                        writeString(green(bold('Restore complete')) + `  → ${dim(target)}`)
                    }
                })
            } catch (err) {
                const message = fmtErr(err)
                if (/No snapshots found/i.test(message)) {
                    writeString(red('Restore failed:') + ' No snapshots found in this repository.')
                    writeString(dim('Run `bekk backup` first, then retry `bekk restore`.'))
                    return
                }
                writeString(red('Restore failed: ') + message)
                return
            }
        }),
    )
