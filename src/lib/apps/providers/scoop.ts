import { commandExists } from '#lib/shell'
import type { App, PackageProvider } from '#lib/types'

import { listScoop } from '../legacy'

export const scoopProvider: PackageProvider = {
    id: 'scoop',
    name: 'Scoop',
    platforms: ['win32'],
    isAvailable: () => commandExists('scoop'),

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
