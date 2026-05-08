import { join } from 'pathe'

// winget and scoop are invoked via powershell.exe which outputs UTF-8.
const utf8 = new TextDecoder('utf-8')

export interface ScoopApp {
    name: string
    version: string
    source: string
}

export interface WingetApp {
    name: string
    id: string
    version: string
    available?: string
    source: string
}

/**
 * Parse a fixed-width text table that uses a dashes-separator row to delimit
 * the header from the data.  Column boundaries are inferred from the positions
 * of the dash groups in the separator line.
 */
const parseFixedWidthTable = (output: string) => {
    const lines = output.split(/\r?\n/)

    // Locate the separator: a line of dash groups and whitespace only
    const sepIdx = lines.findIndex((l) => /^[\s-]+$/.test(l) && /-{2,}/.test(l))
    if (sepIdx < 1) return null

    const header = lines[sepIdx - 1]!
    const sep = lines[sepIdx]!

    // Derive column start positions from dash group positions
    const cols: { start: number; name: string }[] = []
    const dashRe = /-+/g
    let m: RegExpExecArray | null
    while ((m = dashRe.exec(sep)) !== null) cols.push({ start: m.index, name: '' })

    if (cols.length === 0) return null

    // Extract column names from the header line
    for (let i = 0; i < cols.length; i++) {
        const end = cols[i + 1]?.start ?? header.length
        cols[i]!.name = header.substring(cols[i]!.start, end).trim()
    }

    const rows: Record<string, string>[] = []
    for (const line of lines.slice(sepIdx + 1)) {
        if (!line.trim()) continue
        // Skip trailing summary lines like "15 packages found."
        if (/^\d+\s+\S/.test(line.trim())) continue

        const row: Record<string, string> = {}
        for (let i = 0; i < cols.length; i++)
            row[cols[i]!.name] =
                line.length > cols[i]!.start
                    ? line.substring(cols[i]!.start, cols[i + 1]?.start ?? line.length).trim()
                    : ''

        // Skip completely empty rows
        if (Object.values(row).every((v) => !v)) continue
        rows.push(row)
    }
    return rows
}

/**
 * Returns a list of installed Scoop apps, or `null` if Scoop is not installed.
 * Silently returns null on any error (no warning displayed).
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
            'scoop list',
        ],
        { stderr: 'ignore' },
    )
    if (result.exitCode !== 0) return null

    const output = utf8.decode(result.stdout)
    const rows = parseFixedWidthTable(output)
    if (!rows) return []

    return rows
        .filter((r) => r['Name'])
        .map((r) => ({
            name: r['Name'] ?? '',
            version: r['Version'] ?? '',
            // Newer Scoop uses "Source", older uses "Bucket"
            source: r['Source'] ?? r['Bucket'] ?? '',
        }))
}

/**
 * Returns a list of installed winget apps, filtered to only the specified
 * sources.  An empty string `''` in `includeSources` matches apps with no
 * known source (e.g. sideloaded packages).
 */
export const listWinget = (includeSources: string[]) => {
    const result = Bun.spawnSync(
        [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'winget list --disable-interactivity --accept-source-agreements',
        ],
        { stderr: 'ignore' },
    )
    // winget may return non-zero even on success; treat output as best-effort
    const output = utf8.decode(result.stdout)

    // winget's separator is a single continuous dash line (no gaps between columns),
    // and headers are localised. Parse data rows by splitting on 2+ spaces instead.
    const lines = output.split(/\r?\n/)
    const sepIdx = lines.findIndex((l) => /^[\s-]+$/.test(l) && /-{2,}/.test(l))
    if (sepIdx < 0) return []

    const apps: WingetApp[] = []
    for (const line of lines.slice(sepIdx + 1)) {
        if (!line.trim()) continue
        // Skip trailing summary lines like "15 packages found."
        if (/^\d+\s+\S/.test(line.trim())) continue

        // Split by 2+ consecutive spaces to extract columns positionally.
        // Column order is always: Name, Id, Version, [Available,] Source
        const cols = line.trim().split(/\s{2,}/)
        if (cols.length < 3) continue

        const name = cols[0] ?? ''
        const id = cols[1] ?? ''
        const version = cols[2] ?? ''
        // Source is always the last column; Available is present only when there are 5+ cols
        const source = cols[cols.length - 1] ?? ''
        const available = cols.length >= 5 ? (cols[3] ?? '') : undefined

        if (!name || !id) continue
        if (!includeSources.includes(source)) continue

        const app: WingetApp = { name, id, version, source }
        if (available) app.available = available
        apps.push(app)
    }
    return apps
}

/**
 * Backs up installed app lists to `destinationRoot`:
 *   - `scoop.json`  — omitted if Scoop is not installed
 *   - `winget.json` — filtered by `wingetIncludeSources`
 */
export const backupApps = async (destinationRoot: string, wingetIncludeSources: string[]) => {
    const scoop = listScoop()
    const winget = listWinget(wingetIncludeSources)

    if (scoop !== null) {
        await Bun.write(join(destinationRoot, 'scoop.json'), JSON.stringify(scoop, null, 2))
    }
    await Bun.write(join(destinationRoot, 'winget.json'), JSON.stringify(winget, null, 2))

    return { scoop, winget }
}

/**
 * Check whether the current process is running with elevated privileges.
 *   Windows → Administrator (via `net session`)
 *   macOS/Linux → root (uid === 0)
 */
export const isAdmin = () => {
    if (process.platform === 'win32')
        try {
            const result = Bun.spawnSync(['net', 'session'], {
                stdout: 'pipe',
                stderr: 'pipe',
            })
            return result.exitCode === 0
        } catch {
            return false
        }
    // macOS / Linux
    return (process as NodeJS.Process & { getuid?: () => number }).getuid?.() === 0
}
