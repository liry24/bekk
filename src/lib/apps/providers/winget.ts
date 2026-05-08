import { destr } from 'destr'

import { commandExists } from '#lib/shell'
import type { App, PackageProvider } from '#lib/types'

import { configStore } from '../../../store'
import { listWinget } from '../legacy'

const defaultSources = ['winget', 'msstore']

const getWingetSources = async () => {
    const cfg = await configStore.read()
    const parsed = destr<Record<string, Record<string, unknown>>>(cfg.providerConfigsJson)
    const wingetCfg = parsed['winget']
    if (wingetCfg && Array.isArray(wingetCfg['includeSources'])) {
        return wingetCfg['includeSources'] as string[]
    }
    return defaultSources
}

export const wingetProvider: PackageProvider = {
    id: 'winget',
    name: 'Winget',
    platforms: ['win32'],
    isAvailable: () => commandExists('winget'),

    list: async () => {
        const raw = await listWinget(await getWingetSources())
        return raw.map(
            (r) =>
                ({
                    name: r.name,
                    version: r.version,
                    source: r.source,
                    meta: {
                        id: r.id,
                    },
                }) satisfies App,
        )
    },

    install: async (app) => {
        const id = (app.meta?.id as string | undefined) ?? app.name
        const result = Bun.spawnSync(
            [
                'powershell.exe',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `winget install --id "${id}" --exact --accept-source-agreements --disable-interactivity`,
            ],
            { stderr: 'pipe' },
        )
        return result.exitCode === 0
    },
}
