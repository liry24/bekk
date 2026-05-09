import {
    CancelledError,
    confirm,
    input,
    multiselect,
    password,
    select,
    spinner,
} from '@crustjs/prompts'
import { configDir } from '@crustjs/store'
import { bold, cyan, dim, green, yellow } from '@crustjs/style'
import consola from 'consola'
import { destr } from 'destr'
import open from 'open'
import { normalize } from 'pathe'

import { bekkCore } from '#bekk-core'
import { getAvailableProviders } from '#lib/apps'
import { unwrapCoreResult } from '#lib/core-helpers'
import { fmtErr } from '#lib/error'
import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '#lib/github'
import {
    changeRepoPassword,
    deleteS3SecretAccessKey,
    promptPassword,
    resolveRepoPassword,
    setS3SecretAccessKey,
} from '#lib/secrets'
import type { S3Destination } from '#lib/types'

import { app } from '../app'
import { authStore, configStore } from '../store'

// ─── config show ──────────────────────────────────────────────────────────────

const showCmd = app
    .sub('config')
    .sub('show')
    .meta({ description: 'Show current configuration' })
    .run(async () => {
        const cfg = await configStore.read()

        console.log(bold('Backup destination:'), green(cfg.repoPath || dim('(not set)')))
        console.log()

        console.log(bold('Sources:'), cfg.sourcePaths.length === 0 ? dim('(not set)') : '')
        if (cfg.sourcePaths.length !== 0) for (const p of cfg.sourcePaths) console.log('  ' + p)
        console.log()

        const providers = getAvailableProviders()
        if (providers.length > 0) {
            const parsed = destr<Record<string, Record<string, unknown>>>(cfg.providerConfigsJson)
            const wingetSources = parsed['winget']?.['includeSources'] as string[] | undefined
            const srcLabel =
                wingetSources && wingetSources.length > 0
                    ? wingetSources.map((s) => (s === '' ? dim('(blank)') : s)).join(', ')
                    : dim('(none — winget apps will not be backed up)')
            console.log(bold('App List Backup (winget sources):'), srcLabel)
        } else {
            console.log(
                bold('App List Backup:'),
                dim('no package managers available for this platform yet'),
            )
        }
        console.log()

        console.log(bold('Compression:'), cfg.compression === 0 ? 'None' : String(cfg.compression))
        console.log(bold('Pack size:'), `${cfg.packSizeMib} MiB`)
        console.log(bold('Chunk size:'), `${cfg.chunkSizeMib} MiB`)
        console.log(bold('Extra verify:'), cfg.extraVerify ? 'Enabled' : 'Disabled')
        console.log(bold('Snapshot limit:'), cfg.snapshotLimit)
        console.log()

        console.log(
            bold('Password:'),
            cfg.savedPassword ? green('Saved in config file') : dim('OS keychain only'),
        )
        console.log()

        console.log(bold('GitHub Gist:'), cfg.gistEnabled ? green('Enabled') : dim('Disabled'))
        console.log(bold('GitHub Gist ID:'), cfg.gistId || dim('(not set)'))

        const s3Destinations = destr<S3Destination[]>(cfg.s3DestinationsJson) ?? []
        console.log(bold('S3 destinations:'), s3Destinations.length === 0 ? dim('(none)') : '')
        for (const d of s3Destinations) {
            console.log(`  ${d.name}  ${dim(`${d.bucket} (${d.region})`)}`)
        }
    })

// ─── config open ─────────────────────────────────────────────────────────────

const openCmd = app
    .sub('config')
    .sub('open')
    .meta({ description: 'Open config file directory in file explorer' })
    .run(async () => {
        try {
            const dir = configDir('bekk')
            console.log(green('Opening config directory:'), dim(dir))
            await open(dir, { wait: true })
        } catch (err) {
            consola.error('Failed to open config directory:', fmtErr(err))
        }
    })

// ─── helpers ──────────────────────────────────────────────────────────────────

const changePassword = async () => {
    const { repoPath, savedPassword } = await configStore.read()

    if (!repoPath) {
        consola.error('No backup destination configured. Run `bekk config` first.')
        return
    }

    const oldPassword = await resolveRepoPassword()
    if (!oldPassword) {
        consola.error('Could not resolve current repository password.')
        return
    }

    const { password: newPassword, wasGenerated } = await promptPassword(password)

    const saveInConfig = await confirm({
        message: 'Save password to config file?',
        default: savedPassword !== '',
        active: 'Yes  (⚠ synced to Gist/S3 as plaintext)',
        inactive: 'No  (OS credential manager only — recommended)',
    })

    await spinner({
        message: 'Updating repository encryption key…',
        task: async ({ updateMessage }) => {
            await changeRepoPassword({
                repo: repoPath,
                oldPassword,
                newPassword,
                saveToConfig: saveInConfig,
            })
            updateMessage(green('Repository encryption key updated.'))
        },
    })

    if (wasGenerated) {
        console.log()
        console.log(yellow(bold('New auto-generated password:')))
        console.log('  ' + bold(newPassword))
        console.log(dim('  Keep this safe — it is required to restore your backups.'))
    }
    consola.success(green('Password updated.'))
}

const configureDestination = async () => {
    const cfg = await configStore.read()
    const raw = await input({
        message: 'Backup destination path',
        default: cfg.repoPath || undefined,
        placeholder: '/path/to/repo or S3 URL',
    })
    const path = normalize(raw.trim())
    await configStore.patch({ repoPath: path })
    consola.success(green(`Backup destination set: ${bold(path)}`))
}

const configureSources = async () => {
    const cfg = await configStore.read()

    const action = await select<'add' | 'remove'>({
        message: 'Source paths',
        choices: [
            {
                label: 'Add a path',
                value: 'add',
            },
            {
                label: 'Remove paths',
                value: 'remove',
                hint: cfg.sourcePaths.length > 0 ? `${cfg.sourcePaths.length} configured` : 'none',
            },
        ],
    })

    if (action === 'add') {
        consola.info(dim('Enter paths to add (leave blank to finish):'))
        while (true) {
            const raw = await input({
                message: 'Add source path',
                placeholder: 'Leave empty to finish',
            })
            const trimmed = raw.trim()
            if (!trimmed) break
            const path = normalize(trimmed)
            await configStore.update((c) => {
                if (c.sourcePaths.includes(path)) return c
                return { ...c, sourcePaths: [...c.sourcePaths, path] }
            })
        }
    } else {
        const fresh = await configStore.read()
        if (fresh.sourcePaths.length === 0) {
            consola.info(dim('No source paths configured.'))
            return
        }
        const toRemove = await multiselect<string>({
            message: 'Select paths to remove (Space to toggle, Enter to confirm)',
            choices: fresh.sourcePaths.map((p) => ({ label: p, value: p })),
            default: [],
        })
        if (toRemove.length > 0) {
            await configStore.update((c) => ({
                ...c,
                sourcePaths: c.sourcePaths.filter((p) => !toRemove.includes(p)),
            }))
            consola.success(green(`Removed ${toRemove.length} path(s).`))
        }
    }
}

const configureApps = async () => {
    const providers = getAvailableProviders()
    if (providers.length === 0) {
        consola.info('App list — no package managers available for macOS/Linux yet.')
        return
    }

    const cfg = await configStore.read()
    const parsed = destr<Record<string, Record<string, unknown>>>(cfg.providerConfigsJson)
    const currentSources = (parsed['winget']?.['includeSources'] as string[] | undefined) ?? [
        'winget',
        'msstore',
    ]

    const predefined = ['winget', 'msstore', '', 'unknown']
    const customSources = currentSources.filter((s) => !predefined.includes(s))

    const choices = [
        { label: 'winget', value: 'winget', hint: 'community repository' },
        { label: 'msstore', value: 'msstore', hint: 'Microsoft Store' },
        { label: '(blank)', value: '', hint: 'sideloaded / custom installers' },
        { label: 'unknown', value: 'unknown', hint: 'packages without a known source' },
        ...customSources.map((s) => ({ label: s, value: s, hint: 'custom source' })),
        { label: '+ Add custom source', value: '__add_custom__', hint: 'type your own' },
    ]

    const chosen = await multiselect<string>({
        message: 'Winget sources to include in app list backup (Space to toggle)',
        choices,
        default: currentSources,
    })

    let finalSources = chosen.filter((v) => v !== '__add_custom__')

    if (chosen.includes('__add_custom__')) {
        const custom = await input({
            message: 'Custom source name',
            validate: (v) => (v.trim() ? true : 'Source name is required'),
        })
        const trimmed = custom.trim()
        if (trimmed && !finalSources.includes(trimmed)) {
            finalSources.push(trimmed)
        }
    }

    await configStore.patch({
        providerConfigsJson: JSON.stringify({ winget: { includeSources: finalSources } }),
    })
    consola.success(green('App backup settings saved.'))
}

const configureAdvanced = async () => {
    const cfg = await configStore.read()

    type AdvancedAction =
        | 'apps'
        | 'compression'
        | 'packSize'
        | 'chunkSize'
        | 'extraVerify'
        | 'snapshotLimit'
        | 'back'
    let action: AdvancedAction

    do {
        const parsedProviders = destr<Record<string, Record<string, unknown>>>(
            cfg.providerConfigsJson,
        )
        action = await select<AdvancedAction>({
            message: 'Advanced settings',
            choices: [
                {
                    label: 'App list (winget)',
                    value: 'apps',
                    hint:
                        (
                            parsedProviders['winget']?.['includeSources'] as string[] | undefined
                        )?.join(', ') || 'none',
                },
                {
                    label: 'Compression',
                    value: 'compression',
                    hint: cfg.compression === 0 ? 'none' : String(cfg.compression),
                },
                { label: 'Pack size', value: 'packSize', hint: `${cfg.packSizeMib} MiB` },
                { label: 'Chunk size', value: 'chunkSize', hint: `${cfg.chunkSizeMib} MiB` },
                {
                    label: 'Extra verify',
                    value: 'extraVerify',
                    hint: cfg.extraVerify ? 'enabled' : 'disabled',
                },
                {
                    label: 'Snapshot limit',
                    value: 'snapshotLimit',
                    hint: String(cfg.snapshotLimit),
                },
                { label: '← Back', value: 'back' },
            ],
        })

        const fresh = await configStore.read()

        if (action === 'apps') {
            await configureApps()
        } else if (action === 'compression') {
            type CompressionValue = -7 | 0 | 1 | 3 | 6 | 9 | 22
            const level = await select<CompressionValue>({
                message: 'Compression level',
                choices: [
                    {
                        label: 'None (0)',
                        value: 0 as CompressionValue,
                        hint: 'fastest, no compression',
                    },
                    {
                        label: 'Ultra-fast (-7)',
                        value: -7 as CompressionValue,
                        hint: 'zstd ultrafast',
                    },
                    {
                        label: 'Default (1)',
                        value: 1 as CompressionValue,
                        hint: 'zstd level 1 (recommended)',
                    },
                    { label: 'Balanced (3)', value: 3 as CompressionValue, hint: 'zstd level 3' },
                    { label: 'Good (6)', value: 6 as CompressionValue, hint: 'zstd level 6' },
                    { label: 'High (9)', value: 9 as CompressionValue, hint: 'zstd level 9' },
                    {
                        label: 'Max (22)',
                        value: 22 as CompressionValue,
                        hint: 'zstd level 22, slowest',
                    },
                ],
                default: fresh.compression as CompressionValue,
            })
            await configStore.patch({ compression: level })
            consola.success(green(`Compression set to ${level}.`))
        } else if (action === 'packSize') {
            const raw = await input({
                message: 'Data pack size (MiB)',
                default: String(fresh.packSizeMib),
                validate: (v) => {
                    const n = Number(v)
                    return Number.isInteger(n) && n > 0 ? true : 'Must be a positive integer'
                },
            })
            await configStore.patch({ packSizeMib: Number(raw) })
            consola.success(green(`Pack size set to ${raw} MiB.`))
        } else if (action === 'chunkSize') {
            const raw = await input({
                message: 'Average chunk size (MiB)',
                default: String(fresh.chunkSizeMib),
                validate: (v) => {
                    const n = Number(v)
                    return Number.isInteger(n) && n > 0 ? true : 'Must be a positive integer'
                },
            })
            await configStore.patch({ chunkSizeMib: Number(raw) })
            consola.success(green(`Chunk size set to ${raw} MiB.`))
        } else if (action === 'extraVerify') {
            const enabled = await confirm({
                message: 'Extra verify (re-decrypt/decompress before upload)',
                default: fresh.extraVerify,
                active: 'Enable',
                inactive: 'Disable',
            })
            await configStore.patch({ extraVerify: enabled })
            consola.success(green(`Extra verify ${enabled ? 'enabled' : 'disabled'}.`))
        } else if (action === 'snapshotLimit') {
            const raw = await input({
                message: 'Snapshot retention limit',
                default: String(fresh.snapshotLimit),
                validate: (v) => {
                    const n = Number(v)
                    return Number.isInteger(n) && n >= 1
                        ? true
                        : 'Must be a positive integer (min 1)'
                },
            })
            await configStore.patch({ snapshotLimit: Number(raw) })
            consola.success(green(`Snapshot limit set to ${raw}.`))
        }

        // Reload hint values for the next loop iteration
        Object.assign(cfg, await configStore.read())
    } while (action !== 'back')
}

export const configureS3Destinations = async () => {
    type S3Action = 'add' | 'remove' | 'back'
    let action: S3Action

    do {
        const cfg = await configStore.read()
        const destinations = destr<S3Destination[]>(cfg.s3DestinationsJson) ?? []

        const choices: { label: string; value: S3Action; hint?: string }[] = []
        for (const d of destinations) {
            choices.push({
                label: d.name,
                value: 'back',
                hint: `${d.bucket} (${d.region})`,
            })
        }
        choices.push({ label: 'Add destination', value: 'add' })
        if (destinations.length > 0) {
            choices.push({ label: 'Remove destination', value: 'remove' })
        }
        choices.push({ label: '← Back', value: 'back' })

        action = await select<S3Action>({
            message: 'S3 destinations',
            choices,
        })

        if (action === 'add') {
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

            consola.success(green(`S3 destination ${cyan(bold(dest.name))} configured.`))
        } else if (action === 'remove') {
            if (destinations.length === 0) {
                consola.info(dim('No S3 destinations configured.'))
                continue
            }
            const toRemove = await multiselect<string>({
                message: 'Select destinations to remove',
                choices: destinations.map((d) => ({ label: d.name, value: d.name })),
                default: [],
            })
            if (toRemove.length > 0) {
                const updated = destinations.filter((d) => !toRemove.includes(d.name))
                await configStore.patch({ s3DestinationsJson: JSON.stringify(updated) })
                for (const name of toRemove) {
                    await deleteS3SecretAccessKey(name)
                }
                consola.success(green(`Removed ${toRemove.length} destination(s).`))
            }
        }
    } while (action !== 'back')
}

const configureSyncBackends = async () => {
    type SyncAction = 'gist' | 's3' | 'back'
    let action: SyncAction

    do {
        const cfg = await configStore.read()
        const s3Destinations = destr<S3Destination[]>(cfg.s3DestinationsJson) ?? []
        const { token } = await authStore.read()
        const gistStatus =
            cfg.gistEnabled && token
                ? 'enabled'
                : cfg.gistEnabled
                  ? 'enabled (no token)'
                  : 'disabled'

        action = await select<SyncAction>({
            message: 'Sync backends',
            choices: [
                {
                    label: 'GitHub Gist',
                    value: 'gist',
                    hint: gistStatus,
                },
                {
                    label: 'S3 destinations',
                    value: 's3',
                    hint: `${s3Destinations.length} configured`,
                },
                { label: '← Back', value: 'back' },
            ],
        })

        if (action === 'gist') {
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
                    consola.success(green('Gist sync disabled.'))
                }
            } else {
                const ok = await confirm({
                    message: 'Enable Gist sync?',
                    default: true,
                })
                if (ok) {
                    if (!token) {
                        consola.info('Authentication required. Starting GitHub Device Flow...')
                        const newToken = await runDeviceFlow(GITHUB_CLIENT_ID)
                        await authStore.patch({ token: newToken })
                    }
                    await configStore.patch({ gistEnabled: true })
                    consola.success(green('Gist sync enabled.'))
                }
            }
        } else if (action === 's3') {
            await configureS3Destinations()
        }
    } while (action !== 'back')
}

// ─── config (interactive menu) ───────────────────────────────────────────────

export const configCmd = app
    .sub('config')
    .meta({ description: 'Manage configuration' })
    .command(showCmd)
    .command(openCmd)
    .run(async () => {
        try {
            const cfg = await configStore.read()

            type TopAction =
                | 'destination'
                | 'sources'
                | 'password'
                | 'syncBackends'
                | 'advanced'
                | 'done'
            let action: TopAction

            do {
                // Reload hints each iteration
                Object.assign(cfg, await configStore.read())

                const s3Destinations = destr<S3Destination[]>(cfg.s3DestinationsJson)
                const s3Count = Array.isArray(s3Destinations) ? s3Destinations.length : 0
                const syncHint =
                    cfg.gistEnabled || s3Count > 0
                        ? `${cfg.gistEnabled ? 'Gist' : ''}${cfg.gistEnabled && s3Count > 0 ? ', ' : ''}${s3Count > 0 ? `${s3Count} S3` : ''}`
                        : 'not set'

                action = await select<TopAction>({
                    message: 'What do you want to configure?',
                    choices: [
                        {
                            label: 'Backup destination',
                            value: 'destination',
                            hint: cfg.repoPath || 'not set',
                        },
                        {
                            label: 'Source paths',
                            value: 'sources',
                            hint:
                                cfg.sourcePaths.length > 0
                                    ? `${cfg.sourcePaths.length} path(s)`
                                    : 'not set',
                        },
                        {
                            label: 'Password',
                            value: 'password',
                            hint: cfg.savedPassword ? 'saved in config' : 'OS keychain only',
                        },
                        {
                            label: 'Sync backends ▶',
                            value: 'syncBackends',
                            hint: syncHint,
                        },
                        {
                            label: 'Advanced ▶',
                            value: 'advanced',
                        },
                        {
                            label: '✔ Done',
                            value: 'done',
                        },
                    ],
                })

                if (action === 'destination') {
                    await configureDestination()
                } else if (action === 'sources') {
                    await configureSources()
                } else if (action === 'password') {
                    await changePassword()
                } else if (action === 'syncBackends') {
                    await configureSyncBackends()
                } else if (action === 'advanced') {
                    const before = await configStore.read()
                    await configureAdvanced()
                    const after = await configStore.read()
                    const advancedChanged =
                        before.compression !== after.compression ||
                        before.extraVerify !== after.extraVerify ||
                        before.packSizeMib !== after.packSizeMib ||
                        before.chunkSizeMib !== after.chunkSizeMib ||
                        before.snapshotLimit !== after.snapshotLimit

                    if (advancedChanged && after.repoPath) {
                        const { resolveRepoPassword } = await import('../lib/secrets')
                        const pw = await resolveRepoPassword()
                        if (pw) {
                            consola.info(dim('Applying config to repository...'))
                            unwrapCoreResult(
                                await bekkCore.applyConfig(after.repoPath, pw, {
                                    compression: after.compression,
                                    extraVerify: after.extraVerify,
                                    packSizeMib: after.packSizeMib,
                                    chunkSizeMib: after.chunkSizeMib,
                                }),
                            )
                            consola.success(green('Repository config updated.'))
                        }
                    }
                }
            } while (action !== 'done')
        } catch (err) {
            if (err instanceof CancelledError) return
            throw err
        }
    })
