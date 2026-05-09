import { bold, dim, green, red } from '@crustjs/style'
import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { bekkCore } from '#bekk-core'
import type { ProgressEvent } from '#bekk-core'
import { backupAllApps, formatAppListSummary, getAvailableProviders } from '#lib/apps'
import { withRepoAuth, unwrapCoreResult } from '#lib/core-helpers'
import { fmtErr } from '#lib/error'
import { getAppListsDir } from '#lib/paths'
import { createRichProgress, drawPanel, padStart } from '#lib/ui'
import { getRandomSpinner, getSuccessIcon, getErrorIcon } from '#lib/ui/spinner'

import { app } from '../app'

const formatBytes = (n: number): string => {
    if (n === 0) return '0 B'
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    const i = Math.min(units.length - 1, Math.floor(Math.log2(n) / 10))
    const v = n / Math.pow(2, i * 10)
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const formatDuration = (sec: number): string => {
    if (!isFinite(sec) || sec < 0) return '--:--'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const backupCmd = app
    .sub('backup')
    .meta({ description: 'Run local data backup and app list backup' })
    .flags({
        'dry-run': flag(
            z
                .boolean()
                .default(false)
                .describe('Dry run — preview changes without writing to the repository'),
            { short: 'd' },
        ),
        tag: flag(z.string().optional().describe('Tag to attach to the snapshot'), { short: 't' }),
    })
    .run(
        commandValidator(async ({ flags }) => {
            let snapshotId = ''
            let sources: string[] = []
            const progress = createRichProgress({ barWidth: 40 })

            try {
                await withRepoAuth(async (cfg, password) => {
                    if (!cfg.sourcePaths.length) {
                        throw new Error(
                            'No source paths configured. Run `bekk config` to add source paths.',
                        )
                    }

                    sources = [...cfg.sourcePaths]

                    let currentBytes = 0
                    let totalBytes = 0
                    let phaseTitle = 'Preparing repository backup...'
                    let startedAt = 0

                    const handleProgress = (ev: ProgressEvent) => {
                        // Only track bytes-type progress for the bar/details
                        if (ev.progress_type === 'bytes') {
                            if (ev.action === 'set_length' && typeof ev.length === 'number') {
                                totalBytes = Number(ev.length)
                                if (startedAt === 0) startedAt = Date.now()
                            } else if (ev.action === 'inc' && typeof ev.increment === 'number') {
                                currentBytes += Math.max(0, Number(ev.increment))
                            }
                        }

                        if (ev.action === 'set_title' && ev.title) {
                            phaseTitle = ev.title
                        }

                        let title = phaseTitle
                        if (ev.phase === 'prep' && ev.action === 'finish') {
                            title = 'Backing up...'
                        }

                        const pct =
                            totalBytes > 0 ? Math.min(100, (currentBytes / totalBytes) * 100) : 0

                        const details: string[] = []
                        if (totalBytes > 0 && currentBytes > 0 && startedAt > 0) {
                            const elapsedMs = Date.now() - startedAt
                            const elapsedSec = elapsedMs / 1000
                            const lineWidth = 2 + 40 + 1 + 6
                            const sizeStr = `${formatBytes(currentBytes)} / ${formatBytes(totalBytes)}`
                            details.push(padStart(sizeStr, lineWidth))
                            const speed = currentBytes / elapsedSec
                            details.push(padStart(`${formatBytes(speed)}/s`, lineWidth))
                            const remaining = totalBytes - currentBytes
                            const eta = remaining / speed
                            const etaStr = formatDuration(eta)
                            if (etaStr !== '--:--') {
                                details.push(padStart(`ETA ${etaStr}`, lineWidth))
                            }
                        }

                        progress.update({
                            title,
                            bar: pct,
                            details,
                        })
                    }

                    progress.update({ title: 'Preparing repository backup...', bar: 0 })

                    const data = unwrapCoreResult(
                        await bekkCore.backupStream(
                            cfg.repoPath,
                            password,
                            sources,
                            { onProgress: handleProgress },
                            flags['dry-run'],
                            flags.tag,
                            cfg.snapshotLimit,
                        ),
                    )
                    snapshotId = data.snapshot_id
                    progress.finish({ title: `  ${getSuccessIcon()} Completed backing up.` })
                })
            } catch (err) {
                progress.finish({ title: `  ${red('✖')} Backing up...` })
                consola.error(red('Backup failed:'), fmtErr(err))
                return
            }

            // ── App list backup ────────────────────────────────────────────────
            const appListsDir = getAppListsDir()
            let appSummary = ''
            const providers = getAvailableProviders()
            const providerStates = new Map<
                string,
                { state: 'pending' | 'running' | 'done' | 'error'; count?: number; error?: string }
            >()
            for (const p of providers) providerStates.set(p.id, { state: 'pending' })

            let appListTitle = 'Backing up app list...'
            let appListRendered = 0
            const appSpinner = getRandomSpinner()
            let spinnerIdx = 0
            let spinnerTimer: ReturnType<typeof setInterval> | null = null

            const drawAppList = (done = false) => {
                if (appListRendered > 0) {
                    process.stdout.write(`\x1b[${appListRendered}A`)
                }
                const lines: string[] = ['  ' + appListTitle]
                for (const p of providers) {
                    const s = providerStates.get(p.id)
                    if (!s) continue
                    let icon: string
                    let suffix = ''
                    if (s.state === 'pending') {
                        icon = dim('○')
                    } else if (s.state === 'running') {
                        const frame = appSpinner.frames[spinnerIdx % appSpinner.frames.length]
                        icon = frame ?? dim('○')
                    } else if (s.state === 'done') {
                        icon = getSuccessIcon()
                        suffix = `  ${s.count} apps`
                    } else {
                        icon = getErrorIcon()
                        if (s.error) suffix = `  ${dim(s.error)}`
                    }
                    lines.push(`  ${icon} ${p.name}:${suffix}`)
                }
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]
                    if (line === undefined) continue
                    if (i > 0) process.stdout.write('\n')
                    process.stdout.write('\x1b[2K\x1b[0G')
                    process.stdout.write(line)
                }
                process.stdout.write('\n')
                appListRendered = lines.length
                if (done && spinnerTimer) {
                    clearInterval(spinnerTimer)
                    spinnerTimer = null
                }
            }

            spinnerTimer = setInterval(() => {
                spinnerIdx++
                if (appListTitle === 'Backing up app list...') drawAppList()
            }, appSpinner.interval)

            try {
                const result = await backupAllApps(
                    flags['dry-run'] ? undefined : appListsDir,
                    (providerId, state, count) => {
                        const s = providerStates.get(providerId)
                        if (!s) return
                        if (state === 'start') s.state = 'running'
                        else if (state === 'done') {
                            s.state = 'done'
                            s.count = count
                        } else if (state === 'error') {
                            s.state = 'error'
                        }
                        drawAppList()
                    },
                )
                appListTitle = 'Completed backing up app list'
                drawAppList(true)
                appSummary = formatAppListSummary(result)
            } catch (err) {
                if (spinnerTimer) {
                    clearInterval(spinnerTimer)
                    spinnerTimer = null
                }
                consola.warn(dim('App list backup failed:') + ' ' + fmtErr(err))
            }

            // ── Summary panel ──────────────────────────────────────────────────
            const summaryLines = [
                `${bold('Snapshot:')} ${flags['dry-run'] ? dim('(not created)') : green(snapshotId ? snapshotId.slice(0, 8) : dim('—'))}`,
                `${bold('Sources:')}  ${sources.length} path(s)`,
            ]
            if (appSummary) summaryLines.push(`${bold('Apps:')}     ${appSummary}`)
            console.log()
            drawPanel(summaryLines, {
                title: flags['dry-run'] ? 'Dry Run Complete' : 'Backup Complete',
            })
        }),
    )
