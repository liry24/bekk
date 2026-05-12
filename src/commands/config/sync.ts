import { destr } from 'destr'

import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '#lib/github'
import {
    deleteGitHubToken,
    deleteS3SecretAccessKey,
    getGitHubToken,
    setGitHubToken,
} from '#lib/secrets'
import { promptS3Destination, storeS3Secret } from '#lib/s3-helpers'
import type { S3Destination } from '#lib/types'
import { bold, cyan, dim, green, multiselect, confirm, writeString } from '#lib/ui'

import { configStore } from '../../store'
import { runMenu, type MenuItem } from './menu'

type S3Action = 'add' | 'remove' | 'back'
type SyncAction = 'gist' | 's3' | 'back'

const configureS3Destinations = async () => {
    await runMenu<S3Action>(
        'S3 destinations',
        async () => {
            const cfg = await configStore.read()
            const destinations = destr<S3Destination[]>(cfg.s3DestinationsJson) ?? []

            const items: MenuItem<S3Action>[] = []
            for (const d of destinations) {
                items.push({
                    label: d.name,
                    value: 'back',
                    hint: `${d.bucket} (${d.region})`,
                    disabled: true,
                })
            }
            items.push({
                label: 'Add destination',
                value: 'add',
                handler: async () => {
                    const { destination, secretAccessKey } = await promptS3Destination(
                        destinations.map((d) => d.name),
                    )
                    const updated = [...destinations, destination]
                    await configStore.patch({ s3DestinationsJson: JSON.stringify(updated) })
                    await storeS3Secret(destination.name, secretAccessKey)
                },
            })
            if (destinations.length > 0) {
                items.push({
                    label: 'Remove destination',
                    value: 'remove',
                    handler: async () => {
                        if (destinations.length === 0) {
                            writeString(dim('No S3 destinations configured.'))
                            return
                        }
                        const toRemove = await multiselect<string>({
                            message: 'Select destinations to remove',
                            choices: destinations.map((d) => ({ label: d.name, value: d.name })),
                            default: [],
                        })
                        if (toRemove.length > 0) {
                            const updated = destinations.filter((d) => !toRemove.includes(d.name))
                            await configStore.patch({
                                s3DestinationsJson: JSON.stringify(updated),
                            })
                            for (const name of toRemove) {
                                await deleteS3SecretAccessKey(name)
                            }
                            writeString(green(`Removed ${toRemove.length} destination(s).`))
                        }
                    },
                })
            }
            items.push({ label: '← Back', value: 'back' })
            return items
        },
        { backValue: 'back' },
    )
}

export const configureSyncBackends = async () => {
    await runMenu<SyncAction>(
        'Sync backends',
        async () => {
            const cfg = await configStore.read()
            const s3Destinations = destr<S3Destination[]>(cfg.s3DestinationsJson) ?? []
            const token = await getGitHubToken()
            const gistStatus =
                cfg.gistEnabled && token
                    ? 'enabled'
                    : cfg.gistEnabled
                      ? 'enabled (no token)'
                      : 'disabled'

            const items: MenuItem<SyncAction>[] = [
                {
                    label: 'GitHub Gist',
                    value: 'gist',
                    hint: gistStatus,
                    handler: async () => {
                        const token = await getGitHubToken()
                        const cfg = await configStore.read()
                        if (cfg.gistEnabled && token) {
                            const username = await getAuthenticatedUser(token)
                            const ok = await confirm({
                                message: `Gist sync is enabled${username ? ` for ${bold(cyan(username))}` : ''}. Disable it?`,
                                default: false,
                            })
                            if (ok) {
                                await deleteGitHubToken()
                                await configStore.patch({ gistEnabled: false })
                                writeString(green('Gist sync disabled.'))
                            }
                        } else {
                            const ok = await confirm({
                                message: 'Enable Gist sync?',
                                default: true,
                            })
                            if (ok) {
                                if (!token) {
                                    writeString(
                                        'Authentication required. Starting GitHub Device Flow...',
                                    )
                                    const newToken = await runDeviceFlow(GITHUB_CLIENT_ID)
                                    await setGitHubToken(newToken)
                                }
                                await configStore.patch({ gistEnabled: true })
                                writeString(green('Gist sync enabled.'))
                            }
                        }
                    },
                },
                {
                    label: 'S3 destinations',
                    value: 's3',
                    hint: `${s3Destinations.length} configured`,
                    handler: configureS3Destinations,
                },
                { label: '← Back', value: 'back' },
            ]
            return items
        },
        { backValue: 'back' },
    )
}
