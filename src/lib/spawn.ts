export const exec = (args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => {
    const result = Bun.spawnSync(args, { ...opts, stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) {
        throw new Error(new TextDecoder().decode(result.stderr).trim())
    }
    return new TextDecoder().decode(result.stdout).trim()
}
