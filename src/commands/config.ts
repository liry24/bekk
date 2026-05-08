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
import { bold, dim, green, yellow } from '@crustjs/style'
import consola from 'consola'
import open from 'open'
import { normalize } from 'pathe'

import { bekkCore } from '#bekk-core'
import { changeRepoPassword, generatePassword, resolveRepoPassword } from '#lib/secrets'

import { app } from '../app'
import { configStore } from '../store'

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

        const srcLabel =
            cfg.wingetIncludeSources.length > 0
                ? cfg.wingetIncludeSources.map((s) => (s === '' ? dim('(blank)') : s)).join(', ')
                : dim('(none — winget apps will not be backed up)')
        console.log(bold('App List Backup (winget sources):'), srcLabel)
        console.log()

        console.log(bold('Compression:'), cfg.compression === 0 ? 'None' : String(cfg.compression))
        console.log(bold('Pack size:'), `${cfg.packSizeMib} MiB`)
        console.log(bold('Chunk size:'), `${cfg.chunkSizeMib} MiB`)
        console.log(bold('Extra verify:'), cfg.extraVerify ? 'Enabled' : 'Disabled')
        console.log()

        console.log(
            bold('Password:'),
            cfg.savedPassword ? green('Saved in config file') : dim('OS keychain only'),
        )
        console.log()

        console.log(bold('GitHub Gist ID:'), cfg.gistId || dim('(not set)'))
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
        } catch {
            consola.error('An error occurred while trying to open the config directory.')
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

    const entered = await password({
        message: 'New backup password  (press Enter to auto-generate)',
    })

    let newPassword: string
    let wasGenerated = false

    if (entered.trim()) {
        await password({
            message: 'Confirm new password',
            validate: (v) => (v === entered ? true : 'Passwords do not match'),
        })
        newPassword = entered
    } else {
        newPassword = generatePassword()
        wasGenerated = true
    }

    const saveInConfig = await confirm({
        message: 'Save password to config file?',
        default: savedPassword !== '',
        active: 'Yes  (⚠ synced to Gist/S3 as plaintext)',
        inactive: 'No  (OS credential manager only — recommended)',
    })

    await spinner({
        message: 'Updating repository encryption key…',
        task: async ({ updateMessage }) => {
            try {
                await changeRepoPassword({
                    repo: repoPath!,
                    oldPassword,
                    newPassword,
                    saveToConfig: saveInConfig,
                })
                updateMessage(green('Repository encryption key updated.'))
            } catch (err) {
                throw new Error(
                    'Failed to re-key repository: ' +
                        (err instanceof Error ? err.message : String(err)),
                )
            }
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
            consola.success(green(`Added: ${bold(path)}`))
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
    const cfg = await configStore.read()

    const chosen = await multiselect<string>({
        message: 'Winget sources to include in app list backup (Space to toggle)',
        choices: [
            { label: 'winget', value: 'winget', hint: 'community repository' },
            { label: 'msstore', value: 'msstore', hint: 'Microsoft Store' },
            { label: '(blank)', value: '', hint: 'sideloaded / custom installers' },
        ],
        default: cfg.wingetIncludeSources,
    })

    await configStore.patch({ wingetIncludeSources: chosen })
    consola.success(green('App backup settings saved.'))
}

const configureAdvanced = async () => {
    const cfg = await configStore.read()

    type AdvancedAction = 'apps' | 'compression' | 'packSize' | 'chunkSize' | 'extraVerify' | 'back'
    let action: AdvancedAction

    do {
        action = await select<AdvancedAction>({
            message: 'Advanced settings',
            choices: [
                {
                    label: 'App list (winget)',
                    value: 'apps',
                    hint: cfg.wingetIncludeSources.join(', ') || 'none',
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
        }

        // Reload hint values for the next loop iteration
        Object.assign(cfg, await configStore.read())
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

            type TopAction = 'destination' | 'sources' | 'password' | 'advanced' | 'done'
            let action: TopAction

            do {
                // Reload hints each iteration
                Object.assign(cfg, await configStore.read())

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
                } else if (action === 'advanced') {
                    const before = await configStore.read()
                    await configureAdvanced()
                    const after = await configStore.read()
                    const advancedChanged =
                        before.compression !== after.compression ||
                        before.extraVerify !== after.extraVerify ||
                        before.packSizeMib !== after.packSizeMib ||
                        before.chunkSizeMib !== after.chunkSizeMib

                    if (advancedChanged && after.repoPath) {
                        const { resolveRepoPassword } = await import('../lib/secrets')
                        const pw = await resolveRepoPassword()
                        if (pw) {
                            consola.info(dim('Applying config to repository...'))
                            await bekkCore.applyConfig(after.repoPath, pw, {
                                compression: after.compression,
                                extraVerify: after.extraVerify,
                                packSizeMib: after.packSizeMib,
                                chunkSizeMib: after.chunkSizeMib,
                            })
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
