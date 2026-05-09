import { bold, dim, green, table } from '@crustjs/style'
import { flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import { withRepoAuth, unwrapCoreResult } from '#lib/core-helpers'

import { app } from '../app'

const formatTime = (isoStr: string) => new Date(isoStr).toLocaleString()

export const snapshotsCmd = app
    .sub('snapshots')
    .meta({ description: 'List all snapshots in the backup repository' })
    .flags({
        json: flag(z.boolean().default(false).describe('Output raw JSON')),
    })
    .run(async ({ flags }) => {
        const snaps = await withRepoAuth(async (cfg, password) => {
            return unwrapCoreResult(await bekkCore.snapshots(cfg.repoPath, password))
        })

        if (snaps.length === 0) {
            consola.info(dim('No snapshots found.'))
            return
        }

        if (flags.json) {
            console.log(JSON.stringify(snaps, null, 2))
            return
        }

        console.log(
            table(
                ['ID', 'Time', 'Paths', 'Tags', 'Host'],
                snaps.map((s) => [
                    bold(s.id.slice(0, 8)),
                    formatTime(s.time),
                    s.paths.join('\n'),
                    s.tags.length > 0 ? s.tags.join(', ') : dim('—'),
                    s.hostname,
                ]),
            ),
        )
        console.log()
        console.log(green(`${snaps.length} snapshot(s)`))
    })
