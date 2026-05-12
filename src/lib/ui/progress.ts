// ─── progress.ts ─── Rich progress bar (OpenTUI footer) ──────────────────────

import { FrameBufferRenderable, RGBA } from '@opentui/core'

import { stripAnsi } from './layout'
import { clearFooter, ensureHintIsLast, getExtraFooterHeight, getRenderer } from './renderer'
import { getRandomSpinner } from './spinner'

// Horizontal margin applied identically to all widget elements.
const MARGIN = 2

// FrameBuffer colour constants (RGBA — reusable, as recommended by the guide).
const BG = RGBA.fromHex('#000000')
const TEXT = RGBA.fromHex('#FFFFFF')
const DIM = RGBA.fromHex('#888888')
const BAR_FILL = RGBA.fromHex('#00FF00')
const BAR_EMPTY = RGBA.fromHex('#333333')

export interface RichProgress {
    update(options: { title?: string; bar?: number; details?: string[] }): void
    finish(options?: { title?: string }): void
}

export const createRichProgress = async (): Promise<RichProgress> => {
    const r = await getRenderer()
    const spinner = getRandomSpinner()

    let frameIdx = 0
    let finished = false
    let title = ''
    let bar: number | undefined
    let details: string[] = []

    // Single FrameBufferRenderable covers the entire footer widget.
    let fb = new FrameBufferRenderable(r, {
        width: r.width,
        height: 4,
    })

    r.root.add(fb)
    ensureHintIsLast(r)
    r.footerHeight = 4 + getExtraFooterHeight()

    const refresh = () => {
        if (finished) return

        const frame = spinner.frames[frameIdx % spinner.frames.length]!
        const termWidth = r.width
        const totalHeight = 4 + details.length

        // Recreate the framebuffer when dimensions change (details grow/shrink).
        if (fb.width !== termWidth || fb.height !== totalHeight) {
            try {
                r.root.remove(fb.id)
                fb.destroyRecursively()
            } catch {
                // Ignore removal errors (e.g., already destroyed)
            }
            fb = new FrameBufferRenderable(r, {
                width: termWidth,
                height: totalHeight,
            })
            r.root.add(fb)
            ensureHintIsLast(r)
        }

        // Clear background before every draw.
        fb.frameBuffer.fillRect(0, 0, termWidth, totalHeight, BG)

        // Line 0: spinner + title
        fb.frameBuffer.drawText(`${' '.repeat(MARGIN)}${frame} ${title}`, 0, 0, TEXT, BG)

        // Line 2: solid-colour progress bar + right-aligned percentage.
        //   MARGIN + barW + 1(space) + 6(pct) + MARGIN = termWidth
        //   → barW = termWidth - 2·MARGIN - 7
        if (bar !== undefined) {
            const pct = Math.min(100, Math.max(0, bar))
            const pctStr = `${pct.toFixed(1)}%`.padStart(6)
            const barW = Math.max(10, termWidth - 2 * MARGIN - 7)
            const filled = Math.floor(barW * (pct / 100))

            for (let i = 0; i < filled; i++)
                fb.frameBuffer.setCell(MARGIN + i, 2, '█', BAR_FILL, BG)

            for (let i = filled; i < barW; i++)
                fb.frameBuffer.setCell(MARGIN + i, 2, '░', BAR_EMPTY, BG)

            fb.frameBuffer.drawText(pctStr, MARGIN + barW + 1, 2, TEXT, BG)
        }

        // Lines 3+: detail entries.
        for (let i = 0; i < details.length; i++) {
            const detail = details[i]!
            const colonIdx = detail.indexOf(':')
            if (colonIdx >= 0) {
                const key = stripAnsi(detail.slice(0, colonIdx + 1))
                const val = stripAnsi(detail.slice(colonIdx + 1).trimStart())
                const innerPadding = Math.max(
                    1,
                    termWidth - 2 * MARGIN - key.length - 1 - val.length,
                )
                fb.frameBuffer.drawText(`${' '.repeat(MARGIN)}${key}`, 0, 3 + i, DIM, BG)
                fb.frameBuffer.drawText(
                    ' ' + ' '.repeat(innerPadding) + val,
                    MARGIN + key.length,
                    3 + i,
                    TEXT,
                    BG,
                )
            } else {
                fb.frameBuffer.drawText(
                    `${' '.repeat(MARGIN)}${stripAnsi(detail)}`,
                    0,
                    3 + i,
                    TEXT,
                    BG,
                )
            }
        }

        r.footerHeight = totalHeight + getExtraFooterHeight()
        r.requestRender()
    }

    const frameCallback = async (_dt: number) => {
        frameIdx++
        refresh()
    }

    r.requestLive()
    r.setFrameCallback(frameCallback)

    return {
        update(opts: { title?: string; bar?: number; details?: string[] }): void {
            if (finished) return
            if (opts.title !== undefined) title = opts.title
            if (opts.bar !== undefined) bar = opts.bar
            if (opts.details !== undefined) details = opts.details
            refresh()
        },

        finish(_opts?: { title?: string }): void {
            if (finished) return
            finished = true
            r.removeFrameCallback(frameCallback)
            r.dropLive()
            clearFooter(r)
        },
    }
}
