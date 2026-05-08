// ─── progress.ts ─── インラインリッチプログレスバー ─────────────────────────

import { defaultGradient } from './gradient'
import { padStart } from './layout'

type ProgressType = 'spinner' | 'counter' | 'bytes'

interface PhaseInfo {
    name: string
    title: string
    progressType: ProgressType
    current: number
    total: number
    finished: boolean
    startedAt: number
    lastIncAt: number
}

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒']

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

const pickMainPhase = (phases: Map<string, PhaseInfo>): PhaseInfo | undefined => {
    let best: PhaseInfo | undefined
    for (const p of phases.values()) {
        if (p.progressType !== 'bytes') continue
        if (!best || p.lastIncAt > best.lastIncAt) best = p
    }
    return best
}

export interface RichProgress {
    updatePhase(
        name: string,
        options?: {
            title?: string
            current?: number
            increment?: number
            total?: number
            finished?: boolean
            progressType?: ProgressType
        },
    ): void
    finish(finalMessage?: string): void
    render(): void
}

export function createRichProgress(
    options: { barWidth?: number; preparingTitle?: string } = {},
): RichProgress {
    let lastLines = 0
    const barWidth = options.barWidth ?? 40
    const phases = new Map<string, PhaseInfo>()
    let spinnerIdx = 0
    let lastSpinnerAt = 0
    let finished = false
    let renderTimer: ReturnType<typeof setTimeout> | null = null
    const preparingTitle = options.preparingTitle

    function updatePhase(
        name: string,
        opts: {
            title?: string
            current?: number
            increment?: number
            total?: number
            finished?: boolean
            progressType?: ProgressType
        } = {},
    ): void {
        if (finished) return
        const now = Date.now()
        let p = phases.get(name)
        if (!p) {
            p = {
                name,
                title: opts.title ?? name,
                progressType: opts.progressType ?? 'spinner',
                current: opts.current ?? 0,
                total: opts.total ?? 0,
                finished: false,
                startedAt: now,
                lastIncAt: now,
            }
            phases.set(name, p)
        }
        if (opts.title !== undefined) p.title = opts.title
        if (opts.progressType !== undefined) p.progressType = opts.progressType
        if (opts.current !== undefined) {
            p.current = opts.current
            p.lastIncAt = now
        }
        if (opts.increment !== undefined) {
            p.current += opts.increment
            p.lastIncAt = now
        }
        if (opts.total !== undefined) p.total = opts.total
        if (opts.finished !== undefined) {
            p.finished = opts.finished
            if (p.finished && p.total > 0) {
                p.current = p.total
            }
        }
        scheduleRender()
    }

    function finish(finalMessage?: string): void {
        finished = true
        if (renderTimer) {
            clearTimeout(renderTimer)
            renderTimer = null
        }
        if (finalMessage) {
            _update([finalMessage])
            lastLines = 0
        }
    }

    function render(): void {
        if (finished) return
        const now = Date.now()

        if (now - lastSpinnerAt > 120) {
            spinnerIdx = (spinnerIdx + 1) % SPINNER_FRAMES.length
            lastSpinnerAt = now
        }

        const main = pickMainPhase(phases)
        const hasBytesPhase =
            main !== undefined || [...phases.values()].some((p) => p.progressType === 'bytes')

        const lines: string[] = []

        if (!hasBytesPhase && preparingTitle) {
            const icon = SPINNER_FRAMES[spinnerIdx]
            lines.push(`  ${icon} ${preparingTitle}`)
            lines.push('')
            lines.push(`  ${defaultGradient(0, barWidth)}   0.0%`)
            _update(lines)
            scheduleRender()
            return
        }

        for (const p of phases.values()) {
            if (p.finished) continue
            if (main && p.name === main.name) continue
            const icon = SPINNER_FRAMES[spinnerIdx]
            if (p.progressType === 'counter') {
                lines.push(
                    `  ${icon} ${p.title}  ${p.current}${p.total > 0 ? ' / ' + p.total : ''}`,
                )
            } else {
                lines.push(`  ${icon} ${p.title}`)
            }
        }

        if (main) {
            if (lines.length > 0) lines.push('')
            const pct = main.finished
                ? 100
                : main.total > 0
                  ? Math.min(100, (main.current / main.total) * 100)
                  : 0
            const bar = defaultGradient(pct, barWidth)
            const pctStr = padStart(`${pct.toFixed(1)}%`, 6)
            lines.push(`  ${bar} ${pctStr}`)

            const elapsedMs = now - main.startedAt
            const elapsedSec = elapsedMs / 1000
            let speedStr = ''
            let etaStr = ''
            if (main.total > 0 && main.current > 0 && elapsedSec > 0.5) {
                const speed = main.current / elapsedSec
                speedStr = `${formatBytes(speed)}/s`
                const remaining = main.total - main.current
                const eta = remaining / speed
                etaStr = formatDuration(eta)
            }
            const sizeStr = `${formatBytes(main.current)}${main.total > 0 ? ' / ' + formatBytes(main.total) : ''}`
            const statsParts = [main.title, sizeStr, speedStr, etaStr].filter(Boolean)
            lines.push(`  ${statsParts.join('  ')}`)
        }

        for (const p of phases.values()) {
            if (!p.finished) continue
            if (p.progressType === 'counter') {
                lines.push(
                    `  \x1b[38;5;82m◉\x1b[0m ${p.title}  ${p.current}${p.total > 0 ? ' / ' + p.total : ''}`,
                )
            } else {
                lines.push(`  \x1b[38;5;82m◉\x1b[0m ${p.title}`)
            }
        }

        _update(lines)
        scheduleRender()
    }

    function scheduleRender(): void {
        if (renderTimer) clearTimeout(renderTimer)
        renderTimer = setTimeout(() => render(), 200)
    }

    function _update(lines: string[]): void {
        if (lastLines > 0) {
            process.stdout.write(`\x1b[${lastLines}A`)
        }
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (i > 0) process.stdout.write('\n')
            process.stdout.write('\x1b[2K\x1b[0G')
            if (line) process.stdout.write(line)
        }
        if (lastLines > lines.length) {
            for (let i = lines.length; i < lastLines; i++) {
                process.stdout.write('\n')
                process.stdout.write('\x1b[2K\x1b[0G')
            }
            process.stdout.write(`\x1b[${lastLines - lines.length}A`)
        }
        process.stdout.write('\n')
        lastLines = lines.length
    }

    return { updatePhase, finish, render }
}
