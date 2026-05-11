import { destr } from 'destr'

import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '#lib/github'
import { deleteS3SecretAccessKey, setS3SecretAccessKey } from '#lib/secrets'
import type { S3Destination } from '#lib/types'
import { bold, cyan, dim, green, input, multiselect, password, confirm, writeString } from '#lib/ui'

import { authStore, configStore } from '../../store'
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
                    const defaultName = 's3'
                    const name = await input({
                        message: `  Name  ${dim('(used to identify this destination)')}`,
                        placeholder: defaultName,
                        validate: (v) => {
                            if (!v.trim()) return 'Name is required'
                            if (destinations.some((d) => d.name === v.trim()))
                                return 'A destination with this name already exists'
                            return true
                        },
                    })

                    const bucket = await input({
                        message: `  Bucket  ${dim('(S3 bucket name)')}`,
                        placeholder: name.trim(),
                        validate: (v) => (v.trim() ? true : 'Bucket is required'),
                    })

                    const endpoint = await input({
                        message: `  Endpoint  ${dim('(leave blank for AWS standard)')}`,
                        placeholder: 'e.g. https://accountid.r2.cloudflarestorage.com',
                    })

                    const region = await input({
                        message: `  Region`,
                        placeholder: 'us-east-1',
                    })

                    const accessKeyId = await input({
                        message: `  Access Key ID`,
                        validate: (v) => (v.trim() ? true : 'Access Key ID is required'),
                    })

                    const secretAccessKey = await password({
                        message: `  Secret Access Key`,
                        validate: (v) => (v.trim() ? true : 'Secret Access Key is required'),
                    })

                    const dest: S3Destination = {
                        name: name.trim(),
                        bucket: bucket.trim(),
                        region: region.trim() || 'us-east-1',
                        endpoint: endpoint.trim(),
                        accessKeyId: accessKeyId.trim(),
                    }
                    const updated = [...destinations, dest]
                    await configStore.patch({ s3DestinationsJson: JSON.stringify(updated) })
                    await setS3SecretAccessKey(dest.name, secretAccessKey)

                    writeString(green(`S3 destination ${cyan(bold(dest.name))} configured.`))
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
            const { token } = await authStore.read()
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
                        const { token } = await authStore.read()
                        const cfg = await configStore.read()
                        if (cfg.gistEnabled && token) {
                            const username = await getAuthenticatedUser(token)
                            const ok = await confirm({
                                message: `Gist sync is enabled${username ? ` for ${bold(cyan(username))}` : ''}. Disable it?`,
                                default: false,
                            })
                            if (ok) {
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
                                    await authStore.patch({ token: newToken })
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
