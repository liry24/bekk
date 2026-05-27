// ─── layout.ts ─── Terminal width and string formatting utilities ────────────

import { RGBA, StyledText, type TextChunk } from '@opentui/core'

// ── ansiToStyledText ──────────────────────────────────────────────────────────
// Converts an ANSI-SGR-encoded string (produced by bold/dim/green/red in
// style.ts) into an OpenTUI-native StyledText with per-chunk styling.
// OpenTUI's stringToStyledText() does NOT parse escape codes; it treats them
// as literal characters, causing width miscalculations in TextRenderable.
// Use this function any time an ANSI string is assigned to a TextRenderable
// or passed to writeToScrollback.

const _FG_COLOR: Record<number, RGBA> = {
    31: RGBA.fromHex('#FF0000'), // red
    32: RGBA.fromHex('#008000'), // green
    33: RGBA.fromHex('#FFFF00'), // yellow
    34: RGBA.fromHex('#0000FF'), // blue
    36: RGBA.fromHex('#00FFFF'), // cyan
}

const ESC = String.fromCharCode(0x1b)
const ANSI_SGR_PATTERN = new RegExp(`(${ESC}\\[[0-9;]*m)`)
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, 'g')

export const ansiToStyledText = (str: string): StyledText => {
    const chunks: TextChunk[] = []
    const parts = str.split(ANSI_SGR_PATTERN)

    let fg: RGBA | undefined = undefined
    let attrs = 0

    for (const part of parts) {
        if (part.startsWith(`${ESC}[`) && part.endsWith('m')) {
            const codeStr = part.slice(2, -1)
            const codes = codeStr === '' ? [0] : codeStr.split(';').map(Number)
            for (const code of codes) {
                if (code === 0) {
                    fg = undefined
                    attrs = 0
                } else if (code === 1) {
                    attrs |= 1 // BOLD
                } else if (code === 2) {
                    attrs |= 2 // DIM
                } else if (code === 3) {
                    attrs |= 4 // ITALIC
                } else if (_FG_COLOR[code] !== undefined) {
                    fg = _FG_COLOR[code]!
                }
            }
        } else if (part.length > 0) {
            chunks.push({ __isChunk: true, text: part, fg, attributes: attrs })
        }
    }

    if (chunks.length === 0) chunks.push({ __isChunk: true, text: '' })
    return new StyledText(chunks)
}

export const padStart = (s: string, len: number): string => {
    const visibleLen = stripAnsi(s).length
    if (visibleLen >= len) return s
    return ' '.repeat(len - visibleLen) + s
}

export const stripAnsi = (s: string): string => s.replace(ANSI_PATTERN, '')

export const wrapLines = (text: string, maxWidth: number): string[] => {
    const lines: string[] = []
    for (const line of text.split('\n')) {
        const visible = stripAnsi(line)
        if (visible.length <= maxWidth) {
            lines.push(line)
            continue
        }
        let current = ''
        let currentVisible = 0
        let inEscape = false
        let activeEscapes = ''
        for (const char of line) {
            if (char.charCodeAt(0) === 0x1b) {
                inEscape = true
                activeEscapes = char
                current += char
                continue
            }
            if (inEscape) {
                activeEscapes += char
                current += char
                if ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')) inEscape = false

                continue
            }
            const nextVisible = currentVisible + 1
            if (nextVisible > maxWidth && currentVisible > 0) {
                lines.push(current)
                current = activeEscapes + char
                currentVisible = 1
            } else {
                current += char
                currentVisible = nextVisible
            }
        }
        if (current) lines.push(current)
    }
    return lines
}
