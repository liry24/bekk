import { join } from 'pathe'

import type { App } from '#lib/types'

import { getAvailableProviders } from './registry'

export const formatAppListSummary = (result: Record<string, App[] | null>, sep = ', ') =>
    Object.entries(result)
        .filter(([, apps]) => apps !== null)
        .map(([id, apps]) => `${id}: ${apps!.length}`)
        .join(sep)

export const backupAllApps = async (
    destinationRoot: string,
): Promise<Record<string, App[] | null>> => {
    const providers = getAvailableProviders()
    const result: Record<string, App[] | null> = {}

    for (const p of providers) {
        const apps = await p.list()
        result[p.id] = apps
        if (apps !== null) {
            await Bun.write(join(destinationRoot, `${p.id}.json`), JSON.stringify(apps, null, 2))
        }
    }

    return result
}
