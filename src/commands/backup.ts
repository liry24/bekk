import { spinner } from '@crustjs/progress'
import { confirm } from '@crustjs/prompts'
import { dataDir } from '@crustjs/store'
import { bold, cyan, dim, green, link, red, yellow } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { join } from 'pathe'
import { z } from 'zod'

import { app } from '../app'
import { backupApps, listScoop, listWinget } from '../lib/apps'
import { pushGist } from '../lib/github'
import { getOemEncoding } from '../lib/pathUtils'
import { authStore, configStore } from '../store'

// Robocopy exit code meanings
// 0: No files copied (nothing changed)
// 1: Files copied successfully
// 2: Extra files found (mirror: files deleted from dest)
// 4: Mismatched files found
// 8: Some files could not be copied (error)
// 16: Fatal error
// Codes 0–7 = success/warning; 8+ = error

const describeRobocopyExit = (code: number) => {
    if (code >= 16) return { level: 'error', text: 'Fatal error' }
    if (code >= 8) return { level: 'error', text: `Some files could not be copied (code ${code})` }
    if (code === 0) return { level: 'success', text: 'No changes' }
    const parts: string[] = []
    if (code & 1) parts.push('Copied')
    if (code & 2) parts.push('Extra files deleted')
    if (code & 4) parts.push('Mismatches found')
    return { level: code & 4 ? 'warn' : 'success', text: parts.join(' / ') }
}

interface RobocopySummary {
    copied: number
    skipped: number
    failed: number
    total: number
}

const parseRobocopySummary = (output: string) => {
    const summary: RobocopySummary = { copied: 0, skipped: 0, failed: 0, total: 0 }

    // The summary block always has rows in the order: Dirs, Files, Bytes
    // regardless of locale.  Each row matches: "   <label> : n n n n n n"
    // Columns: Total, Copied, Skipped, Mismatch, FAILED, Extras
    const rows = [
        ...output.matchAll(/^\s+[^:\n]+:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/gm),
    ]
    const filesRow = rows[1] // Files is always the 2nd row (index 1), after Dirs
    if (filesRow) {
        summary.total = parseInt(filesRow[1]!, 10)
        summary.copied = parseInt(filesRow[2]!, 10)
        summary.skipped = parseInt(filesRow[3]!, 10)
        summary.failed = parseInt(filesRow[5]!, 10)
    }
    return summary
}

export const backupCmd = app
    .sub('backup')
    .meta({ description: 'Run local data backup and app list backup' })
    .flags({
        mirror: flag(
            z
                .boolean()
                .default(true)
                .describe(
                    'Mirror mode — delete extra files at destination (use --no-mirror to disable)',
                ),
        ),
        retryCount: flag(
            z
                .number()
                .int()
                .min(0)
                .max(999)
                .optional()
                .describe('Retry count on error (default: config value)'),
            { short: 'r' },
        ),
        retryWait: flag(
            z
                .number()
                .int()
                .min(0)
                .max(9999)
                .optional()
                .describe('Retry wait in seconds (default: config value)'),
            { short: 'w' },
        ),
        threads: flag(
            z
                .number()
                .int()
                .min(1)
                .max(128)
                .optional()
                .describe('Thread count (default: config value)'),
            { short: 't' },
        ),
        dryRun: flag(
            z
                .boolean()
                .default(false)
                .describe(
                    'Dry run — preview changes without writing files (applies to both local data and app list backup)',
                ),
            { short: 'd' },
        ),
        log: flag(
            z
                .string()
                .optional()
                .describe('Log file path (default: %LOCALAPPDATA%\\bekk\\Data\\backup.log)'),
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const cfg = await configStore.read()

            if (!cfg.destinationRoot) {
                consola.error('Destination is not configured. Run `bekk init` first.')
                process.exit(1)
            }
            if (cfg.sourcePaths.length === 0) {
                consola.error(
                    'No source paths configured. Use `bekk config add <path>` to add one.',
                )
                process.exit(1)
            }

            // Ask about Gist push upfront (only if authenticated and not a dry run)
            const { token } = await authStore.read()
            const shouldPushGist =
                !flags.dryRun && token != null && token !== ''
                    ? await confirm({
                          message: 'Push config and app lists to Gist after backup?',
                          default: true,
                      })
                    : false

            // Resolve effective options (flag overrides config)
            const mirror = flags.mirror ?? cfg.robocopyMirror
            const retryCount = flags.retryCount ?? cfg.robocopyRetryCount
            const retryWait = flags.retryWait ?? cfg.robocopyRetryWait
            const excludeJunctions = cfg.robocopyExcludeJunctions
            const logPath = flags.log ?? join(dataDir('bekk'), 'backup.log')

            // Build static robocopy args
            const staticArgs: string[] = [
                `/R:${retryCount}`,
                `/W:${retryWait}`,
                // /MT (multi-thread) is intentionally omitted: robocopy buffers stdout
                // in multi-thread mode, breaking real-time streaming via pipe.
                '/NP', // No progress percentage
            ]
            if (mirror) staticArgs.push('/MIR')
            if (excludeJunctions) staticArgs.push('/XJ')
            if (flags.dryRun) staticArgs.push('/L')

            let hasError = false

            for (const src of cfg.sourcePaths) {
                // Convert absolute path to relative for dest structure: E:\foo → E\foo
                const relativePath = src.replace(/^([A-Za-z]):[\\/]/, '$1/')
                const dest = join(cfg.destinationRoot, relativePath)

                const label = `${cyan(src)} → ${dim(dest)}`
                console.log()

                let outputBuffer = ''
                let summaryText = dim('No changes')
                let hasFailed = false

                try {
                    await spinner({
                        message: `Local data backup: ${label}`,
                        task: async ({ updateMessage }) => {
                            const proc = Bun.spawn(['robocopy', src, dest, ...staticArgs], {
                                stdout: 'pipe',
                                stderr: 'pipe',
                            })

                            const reader = proc.stdout.getReader()
                            const decoder = new TextDecoder(getOemEncoding() as Bun.Encoding)
                            let partial = ''

                            while (true) {
                                const { done, value } = await reader.read()
                                if (done) break
                                const chunk = decoder.decode(value, { stream: true })
                                outputBuffer += chunk
                                partial += chunk
                                const lines = partial.split(/\r?\n/)
                                partial = lines.pop() ?? ''
                                for (const line of lines) {
                                    // File copy lines: leading whitespace, status word (no colon),
                                    // then size (number + optional unit), then filename.
                                    // The status word is localized, so we match by structure only.
                                    const fileMatch = line.match(
                                        /^\s+\S[^:\n]*?\s+([\d.,]+\s*[kmgKMG]?)\s+(\S.*)$/,
                                    )
                                    if (fileMatch) {
                                        const fileName = fileMatch[2]!.trim()
                                        updateMessage(
                                            `Local data backup: ${label}  ${dim(flags.dryRun ? '[dry run]' : '→')} ${dim(fileName)}`,
                                        )
                                    }
                                }
                            }
                            if (partial) outputBuffer += partial

                            // Append captured output to log file
                            await Bun.write(
                                Bun.file(logPath),
                                ((await Bun.file(logPath).exists())
                                    ? await Bun.file(logPath).text()
                                    : '') + outputBuffer,
                            )

                            const exitCode = await proc.exited
                            if (exitCode >= 8) throw new Error(describeRobocopyExit(exitCode).text)

                            // Parse summary
                            const summary = parseRobocopySummary(outputBuffer)
                            const parts: string[] = []
                            if (summary.copied > 0) parts.push(green(`Copied: ${summary.copied}`))
                            if (summary.skipped > 0) parts.push(dim(`Skipped: ${summary.skipped}`))
                            if (summary.failed > 0) {
                                parts.push(red(`Failed: ${summary.failed}`))
                                hasFailed = true
                            }
                            summaryText = parts.length > 0 ? parts.join('  ') : dim('No changes')
                            updateMessage(`Local data backup: ${label}  —  ${summaryText}`)
                        },
                    })

                    if (hasFailed) {
                        hasError = true
                        consola.warn(`${label}  —  ${summaryText}`)
                    } else {
                        consola.success(`${label}  —  ${summaryText}`)
                    }
                } catch (err) {
                    hasError = true
                    consola.error(`Local data backup failed: ${label}`)
                    if (err instanceof Error) consola.error(dim(err.message))
                }
            }

            if (hasError) {
                consola.warn(
                    yellow('Some local data backups failed. Check the log: ') + dim(logPath),
                )
                process.exitCode = 1
            } else {
                consola.success(green(bold('Local data backup completed.')))
            }

            // App list backup
            try {
                let summary = ''
                await spinner({
                    message: flags.dryRun ? 'Scanning installed apps...' : 'Saving app lists...',
                    task: async ({ updateMessage }) => {
                        const parts: string[] = []
                        if (flags.dryRun) {
                            const scoop = listScoop()
                            const winget = listWinget(cfg.wingetIncludeSources)
                            if (scoop !== null) parts.push(`Scoop: ${scoop.length} apps`)
                            parts.push(`Winget: ${winget.length} apps`)
                        } else {
                            const { scoop, winget } = await backupApps(
                                cfg.destinationRoot,
                                cfg.wingetIncludeSources,
                            )
                            if (scoop !== null) parts.push(`Scoop: ${scoop.length} apps`)
                            parts.push(`Winget: ${winget.length} apps`)
                        }
                        summary = parts.join('  ')
                        updateMessage(
                            flags.dryRun
                                ? dim('[dry run] ') + `App list backup would save  —  ${summary}`
                                : `App list backup complete  —  ${summary}`,
                        )
                    },
                })
            } catch (err) {
                consola.warn(
                    'App list backup failed: ' + (err instanceof Error ? err.message : String(err)),
                )
            }

            // Push to Gist if requested
            if (shouldPushGist) {
                let gistUrl = ''
                try {
                    await spinner({
                        message: 'Pushing to Gist...',
                        task: async ({ updateMessage }) => {
                            gistUrl = await pushGist(token!)
                            updateMessage('Pushed to Gist: ' + link(gistUrl, gistUrl))
                        },
                    })
                } catch (err) {
                    consola.warn(
                        'Gist push failed: ' + (err instanceof Error ? err.message : String(err)),
                    )
                }
            }
        }),
    )
