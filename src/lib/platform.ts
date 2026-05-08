/**
 * Check whether the current process is running with elevated privileges.
 *   Windows -> Administrator (via `net session`)
 *   macOS/Linux -> root (uid === 0)
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
