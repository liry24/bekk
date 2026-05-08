// ─── gradient.ts ─── ANSI 256色グラデーション ──────────────────────────────

import { stripAnsi } from './layout'

export const color256 = (fg: number) => `\x1b[38;5;${fg}m`
export const colorReset = '\x1b[0m'
export const bold = '\x1b[1m'
export const dim = '\x1b[2m'

/** 線形補間 */
const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t)

/** テキスト全体を start→end の色でグラデーション */
export const gradientText = (text: string, startColor: number, endColor: number): string => {
    const chars = stripAnsi(text).split('')
    let result = ''
    let rawIndex = 0
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 0x1b) {
            // ANSI シーケンスはそのまま通す
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
    const empty = width - filled
    let bar = ''
    for (let i = 0; i < width; i++) {
        const t = width <= 1 ? 0 : i / (width - 1)
        const c = lerp(startColor, endColor, t)
        const char = i < filled ? '█' : '░'
        bar += `${color256(c)}${char}${colorReset}`
    }
    return bar + ' '.repeat(empty > 0 && filled === width ? 0 : 0)
}

/** デフォルトのバックアップ進捗グラデーション: シアン→グリーン */
export const defaultGradient = (percent: number, width: number): string =>
    gradientBar(percent, width, 51, 82)
