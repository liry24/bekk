import { join } from 'pathe'

import type { App } from '#lib/types'

import { getAvailableProviders } from './registry'

export const formatAppListSummary = (result: Record<string, App[] | null>, sep = ', ') =>
    Object.entries(result)
        .filter(([, apps]) => apps !== null)
        .map(([id, apps]) => `${id}: ${apps!.length}`)
        .join(sep)

export const backupAllApps = async (
    destinationRoot: string | undefined,
    onProgress?: (providerId: string, state: 'start' | 'done' | 'error', count?: number) => void,
): Promise<Record<string, App[] | null>> => {
    const providers = getAvailableProviders()
    const result: Record<string, App[] | null> = {}

    await Promise.all(
        providers.map(async (p) => {
            onProgress?.(p.id, 'start')
            try {
                const apps = await p.list()
                result[p.id] = apps
                onProgress?.(p.id, 'done', apps?.length ?? 0)
                if (apps !== null && destinationRoot !== undefined) {
                    await Bun.write(
                        join(destinationRoot, `${p.id}.json`),
                        JSON.stringify(apps, null, 2),
                    )
                }
            } catch {
                result[p.id] = null
                onProgress?.(p.id, 'error')
            }
        }),
    )

    return result
}
