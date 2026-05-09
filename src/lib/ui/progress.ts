// ─── progress.ts ─── インラインリッチプログレスバー ─────────────────────────

import { defaultGradient } from './gradient'
import { padStart } from './layout'
import { getRandomSpinner } from './spinner'

export interface RichProgress {
    update(options: { title?: string; bar?: number; details?: string[] }): void
    finish(options?: { title?: string }): void
}

export function createRichProgress(options: { barWidth?: number } = {}): RichProgress {
    let lastLines = 0
    const barWidth = options.barWidth ?? 40
    let finished = false
    let renderTimer: ReturnType<typeof setTimeout> | null = null
    let spinnerIdx = 0
    let lastSpinnerAt = 0
    const spinner = getRandomSpinner()

    let title = ''
    let bar: number | undefined
    let details: string[] = []

    function update(options: { title?: string; bar?: number; details?: string[] }): void {
        if (finished) return
        if (options.title !== undefined) title = options.title
        if (options.bar !== undefined) bar = options.bar
        if (options.details !== undefined) details = options.details
        scheduleRender()
    }

    function finish(options?: { title?: string }): void {
        if (finished) return
        finished = true
        if (renderTimer) {
            clearTimeout(renderTimer)
            renderTimer = null
        }
        if (lastLines > 0) {
            process.stdout.write(`\x1b[${lastLines}A`)
            for (let i = 0; i < lastLines; i++) {
                if (i > 0) process.stdout.write('\n')
                process.stdout.write('\x1b[2K\x1b[0G')
            }
            process.stdout.write('\n')
        }
        if (options?.title) {
            console.log(options.title)
        }
        lastLines = 0
    }

    function render(): void {
        if (finished) return
        const now = Date.now()

        if (now - lastSpinnerAt >= spinner.interval) {
            spinnerIdx = (spinnerIdx + 1) % spinner.frames.length
            lastSpinnerAt = now
        }

        const lines: string[] = []
        const icon = spinner.frames[spinnerIdx % spinner.frames.length]

        if (title) {
            lines.push(`  ${icon} ${title}`)
        }

        if (bar !== undefined) {
            lines.push('')
            const pct = Math.min(100, Math.max(0, bar))
            const barStr = defaultGradient(pct, barWidth)
            const pctStr = padStart(`${pct.toFixed(1)}%`, 6)
            lines.push(`  ${barStr} ${pctStr}`)
            lines.push('')
        }

        for (const d of details) {
            lines.push(`  ${d}`)
        }

        _update(lines)
        scheduleRender()
    }

    function scheduleRender(): void {
        if (renderTimer) clearTimeout(renderTimer)
        renderTimer = setTimeout(() => render(), 50)
    }

    function _update(lines: string[]): void {
        // Move cursor up to the start of previously rendered block
        if (lastLines > 0) {
            process.stdout.write(`\x1b[${lastLines}A`)
        }
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (i > 0) process.stdout.write('\n')
            process.stdout.write('\x1b[2K\x1b[0G')
            if (line) process.stdout.write(line)
            // Reset ANSI styles to prevent color bleeding on resize / wrap
            process.stdout.write('\x1b[0m')
        }
        // Clear any leftover lines from previous render (+1 safety margin)
        const clearCount = Math.max(0, lastLines - lines.length + 1)
        if (clearCount > 0) {
            for (let i = 0; i < clearCount; i++) {
                process.stdout.write('\n')
                process.stdout.write('\x1b[2K\x1b[0G')
            }
            process.stdout.write(`\x1b[${clearCount}A`)
        }
        process.stdout.write('\n')
        lastLines = lines.length
    }

    return { update, finish }
}
