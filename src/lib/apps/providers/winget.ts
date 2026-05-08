import type { App, PackageProvider } from '#lib/types'

import { configStore } from '../../../store'
import { listWinget } from '../legacy'

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
        const cfg = await configStore.read()
        const raw = listWinget(cfg.wingetIncludeSources)
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
