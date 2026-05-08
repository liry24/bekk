export const commandExists = (cmd: string) => {
    if (process.platform !== 'win32') return false
    const result = Bun.spawnSync(
        [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Get-Command ${cmd} -ErrorAction SilentlyContinue`,
        ],
        { stderr: 'ignore' },
    )
    return result.exitCode === 0
}
