import type { App, PackageProvider } from '#lib/types'

export interface RestoreAnalysis {
    providerId: string
    sameVersion: App[]
    differentVersion: { backup: App; current: App }[]
    missing: App[]
    vanished: App[]
}

const validateAppExists = async (provider: PackageProvider, app: App): Promise<boolean> => {
    if (provider.id === 'winget') {
        const id = (app.meta?.id as string | undefined) ?? app.name
        const result = Bun.spawnSync(
            [
                'winget',
                'show',
                '--id',
                id,
                '--exact',
                '--disable-interactivity',
                '--accept-source-agreements',
            ],
            { stderr: 'ignore' },
        )
        return result.exitCode === 0
    }
    if (provider.id === 'scoop') {
        const name = app.name.replace(/'/g, "''")
        const result = Bun.spawnSync(
            [
                'powershell.exe',
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                `& 'scoop' 'info' '${name}'`,
            ],
            { stderr: 'ignore' },
        )
        return result.exitCode === 0
    }
    return false
}

export const analyzeApps = async (
    backup: Record<string, App[] | null>,
    providers: PackageProvider[],
): Promise<RestoreAnalysis[]> => {
    const results: RestoreAnalysis[] = []

    for (const provider of providers) {
        const backupApps = backup[provider.id] ?? []
        const currentApps = (await provider.list()) ?? []

        const sameVersion: App[] = []
        const differentVersion: { backup: App; current: App }[] = []
        const missing: App[] = []

        for (const bApp of backupApps) {
            const cApp = currentApps.find((a) => a.name === bApp.name)
            if (!cApp) {
                missing.push(bApp)
            } else if (cApp.version === bApp.version) {
                sameVersion.push(bApp)
            } else {
                differentVersion.push({ backup: bApp, current: cApp })
            }
        }

        // Validate missing apps in parallel to find vanished ones
        const vanished: App[] = []
        const validMissing: App[] = []

        if (missing.length > 0) {
            const validations = await Promise.all(
                missing.map(async (app) => ({
                    app,
                    exists: await validateAppExists(provider, app),
                })),
            )
            for (const v of validations) {
                if (v.exists) validMissing.push(v.app)
                else vanished.push(v.app)
            }
        }

        results.push({
            providerId: provider.id,
            sameVersion,
            differentVersion,
            missing: validMissing,
            vanished,
        })
    }

    return results
}

export const installApps = async (
    provider: PackageProvider,
    apps: App[],
    onProgress?: (app: App, success: boolean, error?: string) => void,
): Promise<{ succeeded: number; failed: number }> => {
    let succeeded = 0
    let failed = 0

    for (const app of apps) {
        try {
            const ok = await provider.install(app)
            if (ok) {
                succeeded++
                onProgress?.(app, true)
            } else {
                failed++
                onProgress?.(app, false, 'install command failed')
            }
        } catch (err) {
            failed++
            onProgress?.(app, false, err instanceof Error ? err.message : String(err))
        }
    }

    return { succeeded, failed }
}
