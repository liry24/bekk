import { bold, dim, green, red, table } from '@crustjs/style'
import { flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { bekkCore, type SnapshotEntry } from '#bekk-core'
import { resolveRepoPassword } from '#lib/secrets'

import { app } from '../app'
import { configStore } from '../store'

const formatTime = (isoStr: string) => {
    try {
        return new Date(isoStr).toLocaleString()
    } catch {
        return isoStr
    }
}

export const snapshotsCmd = app
    .sub('snapshots')
    .meta({ description: 'List all snapshots in the backup repository' })
    .flags({
        json: flag(z.boolean().default(false).describe('Output raw JSON')),
    })
    .run(async ({ flags }) => {
        const cfg = await configStore.read()

        if (!cfg.repoPath) {
            throw new Error('Repository is not configured. Run `bekk init` first.')
        }

        const password = await resolveRepoPassword()
        if (!password) {
            throw new Error('Repository password is not stored. Run `bekk config`.')
        }

        const result = await bekkCore.snapshots(cfg.repoPath, password)

        if (result.status === 'error') {
            throw new Error(red('Failed to list snapshots: ') + result.message)
        }

        const snaps: SnapshotEntry[] = 'data' in result ? result.data : []

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
