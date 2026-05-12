import { destr } from 'destr'

import { commandExists } from '#lib/shell'
import type { App, PackageProvider } from '#lib/types'

interface ScoopExportApp {
    Name: string
    Version: string
    Source?: string
    Bucket?: string
}

interface ScoopExport {
    apps?: ScoopExportApp[]
}

const utf8 = new TextDecoder('utf-8')

const listScoop = () => {
    const result = Bun.spawnSync(
        [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            "& 'scoop' 'export'",
        ],
        { stderr: 'ignore' },
    )
    if (result.exitCode !== 0) return null

    const output = utf8.decode(result.stdout)
    const data = destr<ScoopExport>(output)
    if (!data?.apps) return null

    return data.apps.map((r) => ({
        name: r.Name,
        version: r.Version,
        source: r.Source ?? r.Bucket ?? '',
    }))
}

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

    install: async (app) => {
        const pkg = `${app.name}@${app.version}`.replace(/'/g, "''")
        const result = Bun.spawnSync(
            [
                'powershell.exe',
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                `& 'scoop' 'install' '${pkg}'`,
            ],
            { stderr: 'pipe' },
        )
        return result.exitCode === 0
    },
}
