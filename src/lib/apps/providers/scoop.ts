import type { App, PackageProvider } from '#lib/types'

import { listScoop } from '../legacy'

export const scoopProvider: PackageProvider = {
    id: 'scoop',
    name: 'Scoop',
    platforms: ['win32'],

    isAvailable: () => {
        if (process.platform !== 'win32') return false
        const result = Bun.spawnSync(
            [
                'powershell.exe',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-Command scoop -ErrorAction SilentlyContinue',
            ],
            { stderr: 'ignore' },
        )
        return result.exitCode === 0
    },

    list: async () => {
        const raw = listScoop()
        if (raw === null) return null
        return raw.map(
            (r) =>
                ({
                    name: r.name,
                    version: r.version,
                    source: r.source,
                    meta: {},
                }) satisfies App,
        )
    },
}
