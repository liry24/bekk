// ─── style.ts ─── ANSI formatters + layout utilities ─────────────────────────
// These ANSI wrappers are intentionally kept as the canonical way to style
// strings before passing them to writeString().  OpenTUI's stringToStyledText
// parses the escape codes into native TextChunks so the output is still fully
// native.

const ESC = '\x1b['

export const bold = (s: string): string => `${ESC}1m${s}${ESC}0m`
export const dim = (s: string): string => `${ESC}2m${s}${ESC}0m`
export const italic = (s: string): string => `${ESC}3m${s}${ESC}0m`
export const green = (s: string): string => `${ESC}32m${s}${ESC}0m`
export const red = (s: string): string => `${ESC}31m${s}${ESC}0m`
export const yellow = (s: string): string => `${ESC}33m${s}${ESC}0m`
export const cyan = (s: string): string => `${ESC}36m${s}${ESC}0m`
export const blue = (s: string): string => `${ESC}34m${s}${ESC}0m`

// Build ANSI regex without a literal ESC char to satisfy no-control-regex.
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g')

export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

export const padStart = (s: string, len: number): string => {
    const visibleLen = stripAnsi(s).length
    if (visibleLen >= len) return s
    return ' '.repeat(len - visibleLen) + s
}

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
        for (const char of line) {
            const charVisible = char.charCodeAt(0) === 0x1b ? 0 : 1
            const nextVisible = currentVisible + (charVisible || stripAnsi(char).length)
            if (nextVisible > maxWidth && currentVisible > 0) {
                lines.push(current)
                current = char
                currentVisible = charVisible || stripAnsi(char).length
            } else {
                current += char
                currentVisible = nextVisible
            }
        }
        if (current) lines.push(current)
    }
    return lines
}

// ─── orderedList() ───────────────────────────────────────────────────────────
// Renders items as a numbered list (1. ..., 2. ...).

export const orderedList = (items: string[]): string =>
    items.map((item, i) => `  ${i + 1}. ${item}`).join('\n')

// ─── table() ─────────────────────────────────────────────────────────────────
// Renders a table with optional ANSI codes in cells.
// Multi-line cells (split by \n) expand into multiple display rows.

export const table = (headers: string[], rows: string[][]): string => {
    const allRows = [headers, ...rows]

    // Each cell may contain \n; expand into sub-rows
    const expandedRows: string[][][] = allRows.map((row) => row.map((cell) => cell.split('\n')))

    // Column widths: max visible width across all sub-rows
    const colCount = headers.length
    const colWidths: number[] = Array.from({ length: colCount }, () => 0)

    for (const expandedRow of expandedRows) {
        for (let c = 0; c < colCount; c++) {
            const cell = expandedRow[c] ?? ['']
            for (const line of cell) {
                const w = stripAnsi(line).length
                if (w > colWidths[c]!) colWidths[c] = w
            }
        }
    }

    const pad = (s: string, width: number): string => {
        const visible = stripAnsi(s).length
        return s + ' '.repeat(Math.max(0, width - visible))
    }

    const separator = colWidths.map((w) => '─'.repeat(w + 2)).join('┼')
    const headerSep = colWidths.map((w) => '─'.repeat(w + 2)).join('┴')

    const renderRow = (expandedRow: string[][], isHeader: boolean): string => {
        // Find max sub-row count
        const maxLines = Math.max(...expandedRow.map((cell) => cell.length))
        const lines: string[] = []
        for (let li = 0; li < maxLines; li++) {
            const cols = expandedRow.map((cell, c) => {
                const line = cell[li] ?? ''
                return ' ' + pad(line, colWidths[c]!) + ' '
            })
            const style = isHeader ? bold : (s: string) => s
            lines.push(style(cols.join('│')))
        }
        return lines.join('\n')
    }

    const out: string[] = []
    // Header
    out.push(renderRow(expandedRows[0]!, true))
    out.push(separator)
    // Body rows
    for (let i = 1; i < expandedRows.length; i++) {
        if (i > 1) out.push(separator.replace(/[┼]/g, '┼'))
        out.push(renderRow(expandedRows[i]!, false))
    }
    if (expandedRows.length > 1) {
        out.push(headerSep)
    }

    return out.join('\n')
}
