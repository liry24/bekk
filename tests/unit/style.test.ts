import { describe, expect, it } from 'bun:test'

import { stripAnsi } from '../../src/lib/ui/layout'
import {
    bold,
    dim,
    italic,
    green,
    red,
    yellow,
    cyan,
    blue,
    orderedList,
    table,
} from '../../src/lib/ui/style'

describe('ANSI wrappers', () => {
    it('bold wraps text with codes', () => {
        const result = bold('test')
        expect(result).toContain('test')
        expect(stripAnsi(result)).toBe('test')
    })

    it('dim wraps text', () => {
        expect(stripAnsi(dim('test'))).toBe('test')
    })

    it('italic wraps text', () => {
        expect(stripAnsi(italic('test'))).toBe('test')
    })

    it('green wraps text', () => {
        expect(stripAnsi(green('test'))).toBe('test')
    })

    it('red wraps text', () => {
        expect(stripAnsi(red('test'))).toBe('test')
    })

    it('yellow wraps text', () => {
        expect(stripAnsi(yellow('test'))).toBe('test')
    })

    it('cyan wraps text', () => {
        expect(stripAnsi(cyan('test'))).toBe('test')
    })

    it('blue wraps text', () => {
        expect(stripAnsi(blue('test'))).toBe('test')
    })

    it('nested styles work', () => {
        const result = bold(green('success'))
        expect(stripAnsi(result)).toBe('success')
    })
})

describe('orderedList', () => {
    it('numbers items correctly', () => {
        const result = orderedList(['a', 'b', 'c'])
        expect(result).toBe('  1. a\n  2. b\n  3. c')
    })

    it('handles single item', () => {
        expect(orderedList(['only'])).toBe('  1. only')
    })

    it('handles empty array', () => {
        expect(orderedList([])).toBe('')
    })
})

describe('table', () => {
    it('renders headers and rows', () => {
        const result = table(
            ['Name', 'Age'],
            [
                ['Alice', '30'],
                ['Bob', '25'],
            ],
        )
        const lines = result.split('\n')
        expect(lines.length).toBeGreaterThan(2)
        const stripped = stripAnsi(result)
        expect(stripped).toContain('Name')
        expect(stripped).toContain('Age')
        expect(stripped).toContain('Alice')
        expect(stripped).toContain('Bob')
    })

    it('calculates column widths correctly', () => {
        const result = table(['A', 'B'], [['longvalue', 'x']])
        const stripped = stripAnsi(result)
        expect(stripped).toContain('longvalue')
    })

    it('handles multi-line cells', () => {
        const result = table(['Col'], [['line1\nline2']])
        const stripped = stripAnsi(result)
        expect(stripped).toContain('line1')
        expect(stripped).toContain('line2')
    })

    it('handles empty rows', () => {
        const result = table(['H'], [])
        expect(result).toBeDefined()
    })

    it('applies bold to headers', () => {
        const result = table(['Header'], [['data']])
        expect(result).toContain('\x1b[1m')
    })
})
