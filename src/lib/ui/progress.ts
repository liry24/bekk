// ─── progress.ts ─── リッチ・プログレスバー（OpenTUI footer）────────────────

import { dim, StyledText, stringToStyledText, TextRenderable, type TextChunk } from '@opentui/core'

import { styledSolidBar } from './gradient'
import { clearFooter, ensureHintIsLast, getExtraFooterHeight, getRenderer } from './renderer'
import { getRandomSpinner } from './spinner'
import { stripAnsi } from './style'

// Horizontal margin applied identically to all three widget elements (title / bar / details).
// Change this one constant to re-margin the entire widget.
//
//   title:   MARGIN + spinnerFrame + ' ' + title
//   bar:     MARGIN + bar(barW) + ' ' + pctStr(6) + MARGIN  → barW = termWidth - 2·MARGIN - 7
//   detail:  MARGIN + dimKey + ' ' + padding + val + MARGIN  → padding fills to right edge
const MARGIN = 2

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

    // Footer layout:
    //   line1  —  spinner + title
    //   line2  —  empty spacer (between title and bar)
    //   line3  —  progress bar + percentage
    //   line4  —  empty spacer + details (leading \n = blank between bar and details;
    //              height = details.length + 1 when present, 1 when empty)
    //
    // Direct TextRenderables on r.root (same pattern as prompts / task-list).
    const line1 = new TextRenderable(r, { height: 1, content: '' })
    const line2 = new TextRenderable(r, { height: 1, content: '' })
    const line3 = new TextRenderable(r, { height: 1, content: '' })
    const line4 = new TextRenderable(r, { height: 1, content: '' })

    r.root.add(line1)
    r.root.add(line2)
    r.root.add(line3)
    r.root.add(line4)
    ensureHintIsLast(r)
    r.footerHeight = 4 + getExtraFooterHeight()

    const refresh = () => {
        if (finished) return

        const frame = spinner.frames[frameIdx % spinner.frames.length]!
        const termWidth = process.stdout.columns ?? 80
        const pad = ' '.repeat(MARGIN)

        // Line 1: spinner + title (MARGIN left)
        line1.content = `${pad}${frame} ${title}`

        // Line 2: always blank (spacer between title and bar)

        // Line 3: solid-color progress bar + right-aligned percentage.
        //   MARGIN + barW + 1(space) + 6(pct "100.0%") + MARGIN = termWidth
        //   → barW = termWidth - 2·MARGIN - 7
        if (bar !== undefined) {
            const pct = Math.min(100, Math.max(0, bar))
            const pctStr = `${pct.toFixed(1)}%`.padStart(6)
            const barW = Math.max(10, termWidth - 2 * MARGIN - 7)
            const barStyled = styledSolidBar(pct, barW)
            line3.content = new StyledText([
                ...stringToStyledText(pad).chunks,
                ...barStyled.chunks,
                ...stringToStyledText(` ${pctStr}${pad}`).chunks,
            ])
        } else {
            line3.content = ''
        }

        // Line 4: blank spacer line + one detail entry per line.
        // Keys are rendered dim via OpenTUI's dim() (returns TextChunk); values are
        // stripped of caller-supplied ANSI and right-aligned with equal MARGIN on both sides.
        //   MARGIN + key + 1(space) + innerPadding + val + MARGIN = termWidth
        //   → innerPadding = termWidth - 2·MARGIN - key.length - 1 - val.length
        // The leading '\n' creates the blank line between the bar and the detail rows.
        if (details.length > 0) {
            const chunks: TextChunk[] = []
            // Leading empty line — blank gap between bar and details
            chunks.push(...stringToStyledText('\n').chunks)
            for (let i = 0; i < details.length; i++) {
                const detail = details[i]!
                const suffix = i < details.length - 1 ? '\n' : ''
                const colonIdx = detail.indexOf(':')
                if (colonIdx >= 0) {
                    const key = stripAnsi(detail.slice(0, colonIdx + 1))
                    const val = stripAnsi(detail.slice(colonIdx + 1).trimStart())
                    const innerPadding = Math.max(
                        1,
                        termWidth - 2 * MARGIN - key.length - 1 - val.length,
                    )
                    chunks.push(...stringToStyledText(pad).chunks)
                    chunks.push(dim(key))
                    chunks.push(
                        ...stringToStyledText(' ' + ' '.repeat(innerPadding) + val + pad + suffix)
                            .chunks,
                    )
                } else {
                    chunks.push(...stringToStyledText(`${pad}${stripAnsi(detail)}${suffix}`).chunks)
                }
            }
            line4.height = details.length + 1 // +1 for the leading blank line
            line4.content = new StyledText(chunks)
            r.footerHeight = 4 + details.length + getExtraFooterHeight()
        } else {
            line4.height = 1
            line4.content = ''
            r.footerHeight = 4 + getExtraFooterHeight()
        }

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

        finish(opts?: { title?: string }): void {
            if (finished) return
            finished = true
            r.removeFrameCallback(frameCallback)
            r.dropLive()
            if (opts?.title) process.stdout.write(opts.title + '\n')
            clearFooter(r)
        },
    }
}
