import consola from 'consola'
import { destr } from 'destr'

import { getAvailableProviders } from '#lib/apps'
import { green, input, multiselect, select } from '#lib/ui'

import { configStore } from '../../store'
import { runMenu, type MenuItem } from './menu'

type AdvancedAction =
    | 'apps'
    | 'compression'
    | 'packSize'
    | 'chunkSize'
    | 'extraVerify'
    | 'snapshotLimit'
    | 'back'

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

export const configureAdvanced = async () => {
    await runMenu<AdvancedAction>(
        'Advanced settings',
        async () => {
            const cfg = await configStore.read()
            const parsedProviders = destr<Record<string, Record<string, unknown>>>(
                cfg.providerConfigsJson,
            )

            const items: MenuItem<AdvancedAction>[] = [
                {
                    label: 'App list (winget)',
                    value: 'apps',
                    hint:
                        (
                            parsedProviders['winget']?.['includeSources'] as string[] | undefined
                        )?.join(', ') || 'none',
                    handler: configureApps,
                },
                {
                    label: 'Compression',
                    value: 'compression',
                    hint: cfg.compression === 0 ? 'none' : String(cfg.compression),
                    handler: async () => {
                        type CompressionValue = -7 | 0 | 1 | 3 | 6 | 9 | 22
                        const fresh = await configStore.read()
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
                                {
                                    label: 'Balanced (3)',
                                    value: 3 as CompressionValue,
                                    hint: 'zstd level 3',
                                },
                                {
                                    label: 'Good (6)',
                                    value: 6 as CompressionValue,
                                    hint: 'zstd level 6',
                                },
                                {
                                    label: 'High (9)',
                                    value: 9 as CompressionValue,
                                    hint: 'zstd level 9',
                                },
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
                    },
                },
                {
                    label: 'Pack size',
                    value: 'packSize',
                    hint: `${cfg.packSizeMib} MiB`,
                    handler: async () => {
                        const fresh = await configStore.read()
                        const raw = await input({
                            message: 'Data pack size (MiB)',
                            default: String(fresh.packSizeMib),
                            validate: (v) => {
                                const n = Number(v)
                                return Number.isInteger(n) && n > 0
                                    ? true
                                    : 'Must be a positive integer'
                            },
                        })
                        await configStore.patch({ packSizeMib: Number(raw) })
                        consola.success(green(`Pack size set to ${raw} MiB.`))
                    },
                },
                {
                    label: 'Chunk size',
                    value: 'chunkSize',
                    hint: `${cfg.chunkSizeMib} MiB`,
                    handler: async () => {
                        const fresh = await configStore.read()
                        const raw = await input({
                            message: 'Average chunk size (MiB)',
                            default: String(fresh.chunkSizeMib),
                            validate: (v) => {
                                const n = Number(v)
                                return Number.isInteger(n) && n > 0
                                    ? true
                                    : 'Must be a positive integer'
                            },
                        })
                        await configStore.patch({ chunkSizeMib: Number(raw) })
                        consola.success(green(`Chunk size set to ${raw} MiB.`))
                    },
                },
                {
                    label: 'Extra verify',
                    value: 'extraVerify',
                    hint: cfg.extraVerify ? 'enabled' : 'disabled',
                    handler: async () => {
                        const fresh = await configStore.read()
                        const enabled = await select<boolean>({
                            message: 'Extra verify (re-decrypt/decompress before upload)',
                            default: fresh.extraVerify,
                            choices: [
                                { label: 'Enable', value: true },
                                { label: 'Disable', value: false },
                            ],
                        })
                        await configStore.patch({ extraVerify: enabled })
                        consola.success(green(`Extra verify ${enabled ? 'enabled' : 'disabled'}.`))
                    },
                },
                {
                    label: 'Snapshot limit',
                    value: 'snapshotLimit',
                    hint: String(cfg.snapshotLimit),
                    handler: async () => {
                        const fresh = await configStore.read()
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
                    },
                },
                {
                    label: '← Back',
                    value: 'back',
                },
            ]
            return items
        },
        { backValue: 'back' },
    )
}
