// ─── gradient.ts ─── ANSI 256-colour gradient utilities ──────────────────────

import { RGBA, StyledText, fg } from '@opentui/core'

import { stripAnsi } from './layout'

const color256 = (fg: number) => `\x1b[38;5;${fg}m`
const colorReset = '\x1b[0m'

/** Linear interpolation */
const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t)

/** Apply a start→end colour gradient across the entire text */
export const gradientText = (text: string, startColor: number, endColor: number): string => {
    const chars = stripAnsi(text).split('')
    let result = ''
    let rawIndex = 0
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 0x1b) {
            // Pass ANSI sequences through unchanged
            while (i < text.length && text[i] !== 'm') {
                result += text[i]
                i++
            }
            result += text[i]
            continue
        }
        const t = chars.length <= 1 ? 0 : rawIndex / (chars.length - 1)
        const c = lerp(startColor, endColor, t)
        result += `${color256(c)}${text[i]}${colorReset}`
        rawIndex++
    }
    return result
}

export const gradientBar = (
    percent: number,
    width: number,
    startColor: number,
    endColor: number,
): string => {
    const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
    let bar = ''
    for (let i = 0; i < width; i++) {
        const t = width <= 1 ? 0 : i / (width - 1)
        const c = lerp(startColor, endColor, t)
        const char = i < filled ? '█' : '░'
        bar += `${color256(c)}${char}${colorReset}`
    }
    return bar
}

/** Default backup-progress gradient: cyan→green */
export const defaultGradient = (percent: number, width: number): string =>
    gradientBar(percent, width, 51, 82)

// ─── OpenTUI StyledText variants ─────────────────────────────────────────────
// TextRenderable does not interpret raw ANSI escape codes; use these for footer.

export const styledGradientBar = (
    percent: number,
    width: number,
    startColor: number,
    endColor: number,
): StyledText => {
    const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
    const chunks = []
    for (let i = 0; i < width; i++) {
        const t = width <= 1 ? 0 : i / (width - 1)
        const c = lerp(startColor, endColor, t)
        const char = i < filled ? '█' : '░'
        chunks.push(fg(RGBA.fromIndex(c))(char))
    }
    return new StyledText(chunks)
}

/** Default backup-progress gradient (StyledText variant): cyan→green */
export const defaultStyledGradient = (percent: number, width: number): StyledText =>
    styledGradientBar(percent, width, 51, 82)

/**
 * Solid colour bar without a gradient.
 * fillColorIndex: filled chars color (default 255 = bright white)
 * emptyColorIndex: empty chars color (default 238 = dark gray)
 */
export const styledSolidBar = (
    percent: number,
    width: number,
    fillColorIndex: number = 255,
    emptyColorIndex: number = 238,
): StyledText => {
    const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
    const chunks = []
    for (let i = 0; i < filled; i++) {
        chunks.push(fg(RGBA.fromIndex(fillColorIndex))('█'))
    }
    for (let i = filled; i < width; i++) {
        chunks.push(fg(RGBA.fromIndex(emptyColorIndex))('░'))
    }
    return new StyledText(chunks)
}
