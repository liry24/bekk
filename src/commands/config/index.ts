import { configDir } from '@crustjs/store'
import { destr } from 'destr'
import open from 'open'

import { bekkCore } from '#bekk-core'
import { getAvailableProviders } from '#lib/apps'
import { unwrapCoreResult } from '#lib/core-helpers'
import { fmtErr } from '#lib/error'
import type { S3Destination } from '#lib/types'
import { bold, dim, green, red, CancelledError, writeString } from '#lib/ui'

import { app } from '../../app'
import { configStore } from '../../store'
import { configureAdvanced } from './advanced'
import { changePassword, configureDestination, configureSources } from './basic'
import { runMenu, type MenuItem } from './menu'
import { configureSyncBackends } from './sync'

// ─── config show ──────────────────────────────────────────────────────────────

const showCmd = app
    .sub('config')
    .sub('show')
    .meta({ description: 'Show current configuration' })
    .run(async () => {
        const cfg = await configStore.read()

        writeString(bold('Backup destination:') + ' ' + green(cfg.repoPath || dim('(not set)')))
        writeString('')

        writeString(bold('Sources:') + ' ' + (cfg.sourcePaths.length === 0 ? dim('(not set)') : ''))
        if (cfg.sourcePaths.length !== 0) for (const p of cfg.sourcePaths) writeString('  ' + p)
        writeString('')

        const providers = getAvailableProviders()
        if (providers.length > 0) {
            const parsed = destr<Record<string, Record<string, unknown>>>(cfg.providerConfigsJson)
            const wingetSources = parsed['winget']?.['includeSources'] as string[] | undefined
            const srcLabel =
                wingetSources && wingetSources.length > 0
                    ? wingetSources.map((s) => (s === '' ? dim('(blank)') : s)).join(', ')
                    : dim('(none — winget apps will not be backed up)')
            writeString(bold('App List Backup (winget sources):') + ' ' + srcLabel)
        } else
            writeString(
                bold('App List Backup:') +
                    ' ' +
                    dim('no package managers available for this platform yet'),
            )

        writeString('')

        writeString(
            bold('Compression:') + ' ' + (cfg.compression === 0 ? 'None' : String(cfg.compression)),
        )
        writeString(bold('Pack size:') + ' ' + `${cfg.packSizeMib} MiB`)
        writeString(bold('Chunk size:') + ' ' + `${cfg.chunkSizeMib} MiB`)
        writeString(bold('Extra verify:') + ' ' + (cfg.extraVerify ? 'Enabled' : 'Disabled'))
        writeString(bold('Snapshot limit:') + ' ' + cfg.snapshotLimit)
        writeString('')

        writeString(
            bold('Password:') +
                ' ' +
                (cfg.savedPassword ? green('Saved in config file') : dim('OS keychain only')),
        )
        writeString('')

        writeString(
            bold('GitHub Gist:') + ' ' + (cfg.gistEnabled ? green('Enabled') : dim('Disabled')),
        )
        writeString(bold('GitHub Gist ID:') + ' ' + (cfg.gistId || dim('(not set)')))

        const s3Destinations = destr<S3Destination[]>(cfg.s3DestinationsJson) ?? []
        writeString(
            bold('S3 destinations:') + ' ' + (s3Destinations.length === 0 ? dim('(none)') : ''),
        )
        for (const d of s3Destinations)
            writeString(`  ${d.name}  ${dim(`${d.bucket} (${d.region})`)}`)
    })

// ─── config open ─────────────────────────────────────────────────────────────

const openCmd = app
    .sub('config')
    .sub('open')
    .meta({ description: 'Open config file directory in file explorer' })
    .run(async () => {
        try {
            const dir = configDir('bekk')
            writeString(green('Opening config directory:') + ' ' + dim(dir))
            await open(dir, { wait: true })
        } catch (err) {
            writeString(red('Failed to open config directory:') + ' ' + fmtErr(err))
        }
    })

// ─── config (interactive menu) ───────────────────────────────────────────────

type TopAction = 'destination' | 'sources' | 'password' | 'syncBackends' | 'advanced' | 'done'

export const configCmd = app
    .sub('config')
    .meta({ description: 'Manage configuration' })
    .command(showCmd)
    .command(openCmd)
    .run(async () => {
        try {
            await runMenu<TopAction>(
                'What do you want to configure?',
                async () => {
                    const cfg = await configStore.read()

                    const s3Destinations = destr<S3Destination[]>(cfg.s3DestinationsJson)
                    const s3Count = Array.isArray(s3Destinations) ? s3Destinations.length : 0
                    const syncHint =
                        cfg.gistEnabled || s3Count > 0
                            ? `${cfg.gistEnabled ? 'Gist' : ''}${cfg.gistEnabled && s3Count > 0 ? ', ' : ''}${s3Count > 0 ? `${s3Count} S3` : ''}`
                            : 'not set'

                    const items: MenuItem<TopAction>[] = [
                        {
                            label: 'Backup destination',
                            value: 'destination',
                            hint: cfg.repoPath || 'not set',
                            handler: configureDestination,
                        },
                        {
                            label: 'Source paths',
                            value: 'sources',
                            hint:
                                cfg.sourcePaths.length > 0
                                    ? `${cfg.sourcePaths.length} path(s)`
                                    : 'not set',
                            handler: configureSources,
                        },
                        {
                            label: 'Password',
                            value: 'password',
                            hint: cfg.savedPassword ? 'saved in config' : 'OS keychain only',
                            handler: changePassword,
                        },
                        {
                            label: 'Sync backends ▶',
                            value: 'syncBackends',
                            hint: syncHint,
                            handler: configureSyncBackends,
                        },
                        {
                            label: 'Advanced ▶',
                            value: 'advanced',
                            handler: async () => {
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
                                    const { resolveRepoPassword } =
                                        await import('../../lib/secrets')
                                    const pw = await resolveRepoPassword()
                                    if (pw) {
                                        writeString(dim('Applying config to repository...'))
                                        unwrapCoreResult(
                                            await bekkCore.applyConfig(after.repoPath, pw, {
                                                compression: after.compression,
                                                extraVerify: after.extraVerify,
                                                packSizeMib: after.packSizeMib,
                                                chunkSizeMib: after.chunkSizeMib,
                                            }),
                                        )
                                        writeString(green('Repository config updated.'))
                                    }
                                }
                            },
                        },
                        {
                            label: '✔ Done',
                            value: 'done',
                        },
                    ]
                    return items
                },
                { backValue: 'done' },
            )
        } catch (err) {
            if (err instanceof CancelledError) return
            throw err
        }
    })
