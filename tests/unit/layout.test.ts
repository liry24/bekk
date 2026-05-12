import { describe, expect, it } from 'bun:test'

import { padStart, stripAnsi, wrapLines } from '../../src/lib/ui/layout'

describe('stripAnsi', () => {
    it('strips simple color codes', () => {
        expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
    })

    it('strips multiple codes', () => {
        expect(stripAnsi('\x1b[1m\x1b[32mbold green\x1b[0m')).toBe('bold green')
    })

    it('strips 256-color codes', () => {
        expect(stripAnsi('\x1b[38;5;208morange\x1b[0m')).toBe('orange')
    })

    it('returns plain text unchanged', () => {
        expect(stripAnsi('plain text')).toBe('plain text')
    })

    it('handles empty string', () => {
        expect(stripAnsi('')).toBe('')
    })

    it('strips codes with semicolons', () => {
        expect(stripAnsi('\x1b[1;32mstyled\x1b[0m')).toBe('styled')
    })
})

describe('padStart', () => {
    it('pads short strings', () => {
        expect(padStart('hi', 5)).toBe('   hi')
    })

    it('does not pad strings that are already long enough', () => {
        expect(padStart('hello', 3)).toBe('hello')
    })

    it('handles ANSI codes by measuring visible length', () => {
        expect(padStart('\x1b[32mhi\x1b[0m', 5)).toBe('   \x1b[32mhi\x1b[0m')
    })

    it('handles exact length', () => {
        expect(padStart('abc', 3)).toBe('abc')
    })
})

describe('wrapLines', () => {
    it('does not wrap short lines', () => {
        expect(wrapLines('short', 20)).toEqual(['short'])
    })

    it('wraps long lines', () => {
        const result = wrapLines('abcdefghijklmnop', 5)
        expect(result).toEqual(['abcde', 'fghij', 'klmno', 'p'])
    })

    it('handles multiple input lines', () => {
        const result = wrapLines('line1\nline2', 10)
        expect(result).toEqual(['line1', 'line2'])
    })

    it('preserves ANSI codes when wrapping', () => {
        const input = '\x1b[32mhello world\x1b[0m'
        const result = wrapLines(input, 5)
        expect(result.length).toBeGreaterThan(1)
        expect(result.join('')).toContain('\x1b[32m')
    })

    it('handles empty string', () => {
        expect(wrapLines('', 10)).toEqual([''])
    })

    it('handles exact width', () => {
        expect(wrapLines('abcde', 5)).toEqual(['abcde'])
    })

    it('BUG: does not correctly track ANSI state across wraps', () => {
        const input = '\x1b[32mhello world\x1b[0m'
        const result = wrapLines(input, 5)
        const stripped = result.map(stripAnsi).join('')
        expect(stripped).toBe('hello world')
    })
})
