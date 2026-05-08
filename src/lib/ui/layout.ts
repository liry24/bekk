// ─── layout.ts ─── ターミナル幅と文字列整形ユーティリティ ───────────────────

export const termWidth = (): number => process.stdout.columns || 80

export const padEnd = (s: string, len: number): string => {
    const visibleLen = stripAnsi(s).length
    if (visibleLen >= len) return s
    return s + ' '.repeat(len - visibleLen)
}

export const padStart = (s: string, len: number): string => {
    const visibleLen = stripAnsi(s).length
    if (visibleLen >= len) return s
    return ' '.repeat(len - visibleLen) + s
}

export const truncate = (s: string, max: number, suffix = '…'): string => {
    const visible = stripAnsi(s)
    if (visible.length <= max) return s
    return visible.slice(0, max - suffix.length) + suffix
}

export const stripAnsi = (s: string): string =>
    s.replace(new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[a-zA-Z]`, 'g'), '')

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
            const charVisible = char.charCodeAt(0) >= 0x1b ? 0 : 1
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

export const center = (s: string, width: number): string => {
    const visibleLen = stripAnsi(s).length
    if (visibleLen >= width) return s
    const left = Math.floor((width - visibleLen) / 2)
    return ' '.repeat(left) + s + ' '.repeat(width - visibleLen - left)
}
