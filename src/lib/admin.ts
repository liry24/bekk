/**
 * Check whether the current process is running with Windows Administrator privileges.
 * Uses `net session` which requires elevation; exit code 0 means admin.
 */
export const isAdmin = () => {
    try {
        const result = Bun.spawnSync(['net', 'session'], {
            stdout: 'pipe',
            stderr: 'pipe',
        })
        return result.exitCode === 0
    } catch {
        return false
    }
}
