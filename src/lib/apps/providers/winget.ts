import { randomUUID } from 'node:crypto'

import { destr } from 'destr'

import { commandExists } from '#lib/shell'
import type { App, PackageProvider } from '#lib/types'

import { configStore } from '../../../store'

interface WingetExportPackage {
    PackageIdentifier: string
    Version: string
}

interface WingetExportSource {
    Packages: WingetExportPackage[]
    SourceDetails: { Name: string }
}

interface WingetExportJson {
    Sources: WingetExportSource[]
}

const listWinget = async (includeSources: string[]) => {
    const tmpFile = `${process.env.TEMP ?? 'C:\\\\Windows\\\\Temp'}\\bekk-winget-export-${randomUUID()}.json`

    try {
        const exportResult = Bun.spawnSync(
            [
                'winget',
                'export',
                '-o',
                tmpFile,
                '--include-versions',
                '--accept-source-agreements',
                '--disable-interactivity',
            ],
            { stderr: 'ignore' },
        )

        if (exportResult.exitCode !== 0) return []

        const file = Bun.file(tmpFile)
        if (!(await file.exists())) return []

        const text = await file.text()
        const data = destr<WingetExportJson>(text)
        if (!data?.Sources) return []

        const apps: {
            name: string
            id: string
            version: string
            source: string
        }[] = []

        for (const source of data.Sources) {
            const sourceName = source.SourceDetails?.Name ?? ''
            if (!includeSources.includes(sourceName)) continue
            for (const pkg of source.Packages) {
                apps.push({
                    name: pkg.PackageIdentifier,
                    id: pkg.PackageIdentifier,
                    version: pkg.Version,
                    source: sourceName,
                })
            }
        }

        return apps
    } finally {
        try {
            await Bun.file(tmpFile).delete()
        } catch {
            // ignore cleanup errors
        }
    }
}

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
                'winget',
                'install',
                '--id',
                id,
                '--exact',
                '--accept-source-agreements',
                '--disable-interactivity',
            ],
            { stderr: 'pipe' },
        )
        return result.exitCode === 0
    },
}
