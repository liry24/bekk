// ─── layout.ts ─── Terminal width and string formatting utilities ────────────

export const padStart = (s: string, len: number): string => {
    const visibleLen = stripAnsi(s).length
    if (visibleLen >= len) return s
    return ' '.repeat(len - visibleLen) + s
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
