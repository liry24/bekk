import { flag } from '@crustjs/validate/zod'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import { withRepoAuth, unwrapCoreResult } from '#lib/core-helpers'
import { bold, dim, green, table, getRenderer, writeString } from '#lib/ui'

import { app } from '../app'

const formatTime = (isoStr: string) => new Date(isoStr).toLocaleString()

export const snapshotsCmd = app
    .sub('snapshots')
    .meta({ description: 'List all snapshots in the backup repository' })
    .flags({
        json: flag(z.boolean().default(false).describe('Output raw JSON')),
    })
    .run(async ({ flags }) => {
        await getRenderer()
        const snaps = await withRepoAuth(async (cfg, password) => {
            return unwrapCoreResult(await bekkCore.snapshots(cfg.repoPath, password))
        })

        if (snaps.length === 0) {
            writeString(dim('No snapshots found.'))
            return
        }

        if (flags.json) {
            writeString(JSON.stringify(snaps, null, 2))
            return
        }

        writeString(
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
        writeString('')
        writeString(green(`${snaps.length} snapshot(s)`))
    })
