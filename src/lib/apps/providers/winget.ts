import { destr } from 'destr'

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

    isAvailable: () => {
        if (process.platform !== 'win32') return false
        const result = Bun.spawnSync(
            [
                'powershell.exe',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-Command winget -ErrorAction SilentlyContinue',
            ],
            { stderr: 'ignore' },
        )
        return result.exitCode === 0
    },

    list: async () => {
        const raw = listWinget(await getWingetSources())
        return raw.map(
            (r) =>
                ({
                    name: r.name,
                    version: r.version,
                    source: r.source,
                    meta: {
                        id: r.id,
                        available: r.available,
                    },
                }) satisfies App,
        )
    },
}
