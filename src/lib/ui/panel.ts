// ─── panel.ts ─── Unicode Box Drawing パネル描画 ────────────────────────────

import { stripAnsi, wrapLines } from './layout'

const BOX = {
    tl: '┌',
    tr: '┐',
    bl: '└',
    br: '┘',
    h: '─',
    v: '│',
}

export interface PanelOptions {
    title?: string
    width?: number
    padding?: number
    borderColor?: number
    titleColor?: number
}

export const renderPanel = (content: string[], options: PanelOptions = {}): string[] => {
    const { title, width: optWidth, padding = 1, borderColor, titleColor } = options

    const maxContentWidth =
        optWidth ??
        Math.max(
            ...content.map((l) => stripAnsi(l).length),
            title ? stripAnsi(title).length + 4 : 0,
        )
    const innerWidth = maxContentWidth + padding * 2

    const colored = (s: string, c?: number) => (c !== undefined ? `\x1b[38;5;${c}m${s}\x1b[0m` : s)

    const topLine = title
        ? colored(BOX.tl, borderColor) +
          colored(BOX.h, borderColor).repeat(2) +
          ' ' +
          colored(title, titleColor) +
          ' ' +
          colored(BOX.h, borderColor).repeat(innerWidth - stripAnsi(title).length - 4) +
          colored(BOX.tr, borderColor)
        : colored(BOX.tl, borderColor) +
          colored(BOX.h, borderColor).repeat(innerWidth) +
          colored(BOX.tr, borderColor)

    const bodyLines = content.flatMap((line) => {
        const wrapped = wrapLines(line, maxContentWidth)
        return wrapped.map((l) => {
            const visible = stripAnsi(l)
            const rightPad = Math.max(0, innerWidth - padding * 2 - visible.length)
            return (
                colored(BOX.v, borderColor) +
                ' '.repeat(padding) +
                l +
                ' '.repeat(rightPad) +
                ' '.repeat(padding) +
                colored(BOX.v, borderColor)
            )
        })
    })

    const bottomLine =
        colored(BOX.bl, borderColor) +
        colored(BOX.h, borderColor).repeat(innerWidth) +
        colored(BOX.br, borderColor)

    return [topLine, ...bodyLines, bottomLine]
}

export const drawPanel = (content: string[], options?: PanelOptions): void => {
    for (const line of renderPanel(content, options)) {
        console.log(line)
    }
}
