import { destr } from 'destr'

// winget and scoop are invoked via powershell.exe which outputs UTF-8.
const utf8 = new TextDecoder('utf-8')

interface ScoopExportApp {
    Name: string
    Version: string
    Source?: string
    Bucket?: string
}

interface ScoopExport {
    apps?: ScoopExportApp[]
}

/**
 * Returns a list of installed Scoop apps, or `null` if Scoop is not installed.
 * Uses `scoop export` which outputs stable JSON.
 */
export const listScoop = () => {
    // -ExecutionPolicy Bypass is required: scoop is a .ps1 script and the default
    // policy in a Bun child process blocks unsigned scripts.
    const result = Bun.spawnSync(
        [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'scoop export',
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
        // Newer Scoop uses "Source", older uses "Bucket"
        source: r.Source ?? r.Bucket ?? '',
    }))
}

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

/**
 * Returns a list of installed winget apps using `winget export` which emits
 * stable JSON with PackageIdentifier and Version.
 */
export const listWinget = async (includeSources: string[]) => {
    const tmpFile = `${process.env.TEMP ?? '/tmp'}/bekk-winget-export-${Date.now()}.json`
    const exportResult = Bun.spawnSync(
        [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `winget export -o "${tmpFile}" --include-versions --accept-source-agreements --disable-interactivity`,
        ],
        { stderr: 'ignore' },
    )

    if (exportResult.exitCode !== 0) return []

    const file = Bun.file(tmpFile)
    if (!(await file.exists())) return []

    const text = await file.text()
    try {
        await Bun.write(tmpFile, '')
        await file.delete()
    } catch {
        // ignore cleanup errors
    }

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
}
