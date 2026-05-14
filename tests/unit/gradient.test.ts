import { describe, expect, it } from 'bun:test'

import {
    gradientText,
    gradientBar,
    styledGradientBar,
    styledSolidBar,
} from '../../src/lib/ui/gradient'
import { stripAnsi } from '../../src/lib/ui/layout'

describe('gradientText', () => {
    it('applies gradient to text', () => {
        const result = gradientText('hello', 51, 82)
        expect(stripAnsi(result)).toBe('hello')
    })

    it('preserves existing ANSI codes', () => {
        const result = gradientText('\x1b[1mbold\x1b[0m', 51, 82)
        expect(stripAnsi(result)).toBe('bold')
    })

    it('handles single character', () => {
        const result = gradientText('X', 51, 82)
        expect(stripAnsi(result)).toBe('X')
    })

    it('handles empty string', () => {
        const result = gradientText('', 51, 82)
        expect(result).toBe('')
    })

    it('produces color codes for each char', () => {
        const result = gradientText('abc', 0, 255)
        const ESC = String.fromCharCode(0x1b)
        const regex = new RegExp(`${ESC}\\[38;5;\\d+m`, 'g')
        const matches = result.match(regex)
        expect(matches).not.toBeNull()
        expect(matches!.length).toBe(3)
    })
})

describe('gradientBar', () => {
    it('creates bar with correct width', () => {
        const result = gradientBar(50, 10, 51, 82)
        const stripped = stripAnsi(result)
        expect(stripped.length).toBe(10)
    })

    it('fills correctly at 100%', () => {
        const result = gradientBar(100, 5, 51, 82)
        const stripped = stripAnsi(result)
        expect(stripped).toBe('█████')
    })

    it('fills partially at 50%', () => {
        const result = gradientBar(50, 10, 51, 82)
        const stripped = stripAnsi(result)
        const filled = stripped.split('').filter((c) => c === '█').length
        const empty = stripped.split('').filter((c) => c === '░').length
        expect(filled).toBe(5)
        expect(empty).toBe(5)
    })

    it('handles 0%', () => {
        const result = gradientBar(0, 5, 51, 82)
        const stripped = stripAnsi(result)
        expect(stripped).toBe('░░░░░')
    })

    it('handles width 1', () => {
        const result = gradientBar(50, 1, 51, 82)
        expect(stripAnsi(result).length).toBe(1)
    })

    it('clamps percent to 0-100', () => {
        const neg = gradientBar(-10, 5, 51, 82)
        const over = gradientBar(200, 5, 51, 82)
        expect(stripAnsi(neg)).toBe('░░░░░')
        expect(stripAnsi(over)).toBe('█████')
    })
})

describe('styledGradientBar', () => {
    it('creates StyledText with correct chunks', () => {
        const result = styledGradientBar(50, 5, 51, 82)
        expect(result.chunks.length).toBe(5)
    })

    it('handles 0%', () => {
        const result = styledGradientBar(0, 5, 51, 82)
        expect(result.chunks.length).toBe(5)
        expect(result.chunks[0]!.text).toBe('░')
    })

    it('handles 100%', () => {
        const result = styledGradientBar(100, 5, 51, 82)
        expect(result.chunks.length).toBe(5)
        expect(result.chunks[0]!.text).toBe('█')
    })
})

describe('styledSolidBar', () => {
    it('creates solid color bar', () => {
        const result = styledSolidBar(50, 10, 255, 238)
        expect(result.chunks.length).toBe(10)
    })

    it('uses default colors', () => {
        const result = styledSolidBar(50, 5)
        expect(result.chunks.length).toBe(5)
    })

    it('handles 0%', () => {
        const result = styledSolidBar(0, 5)
        expect(result.chunks.every((c) => c.text === '░')).toBe(true)
    })

    it('handles 100%', () => {
        const result = styledSolidBar(100, 5)
        expect(result.chunks.every((c) => c.text === '█')).toBe(true)
    })
})
