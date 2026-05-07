/**
 * Normalize path separators to forward slashes.
 * Both `C:\foo\bar` and `C:/foo/bar` are stored as `C:/foo/bar`.
 */
export const normalizePath = (p: string) => p.replace(/\\/g, '/')

/**
 * Convert a stored path to the format expected by rustic's `--repo` argument.
 * Windows drive paths (e.g. `C:/path`) must be prefixed with `local:` to prevent
 * rustic from interpreting the drive letter as a backend type identifier.
 * rclone remote paths (e.g. `myremote:bucket/path`) are passed through unchanged.
 */
export const toRepoArg = (p: string) => (/^[A-Za-z]:/.test(p) ? `local:${p}` : p)

/**
 * Returns the Windows OEM console encoding as a WHATWG-compatible label
 * (e.g. 'shift_jis', 'utf-8', 'windows-1252').
 * Result is cached after the first call.
 * Used to decode robocopy / winget / scoop output correctly.
 */
let _oemEncoding: string | null = null
export const getOemEncoding = () => {
    if (_oemEncoding !== null) return _oemEncoding
    try {
        const result = Bun.spawnSync(
            [
                'powershell.exe',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                // Use OEM code page directly — [Console]::OutputEncoding can differ
                // from the actual OEM code page when run as a Bun child process.
                '[System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage).WebName',
            ],
            { stderr: 'ignore' },
        )
        if (result.exitCode === 0) {
            const name = new TextDecoder('utf-8').decode(result.stdout).trim()
            if (name) {
                _oemEncoding = name
                return name
            }
        }
    } catch {
        // ignore
    }
    _oemEncoding = 'utf-8'
    return 'utf-8'
}
