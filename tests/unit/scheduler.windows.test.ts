import { describe, expect, it } from 'bun:test'

import { buildTriggerArgs, escapeWindowsArg } from '../../src/lib/scheduler/windows'

// ─── escapeWindowsArg ─────────────────────────────────────────────────────────

describe('escapeWindowsArg', () => {
    it('returns plain arg unchanged (no special chars)', () => {
        expect(escapeWindowsArg('hello')).toBe('hello')
    })

    it('wraps arg containing a space in double quotes', () => {
        const result = escapeWindowsArg('hello world')
        expect(result).toBe('"hello world"')
    })

    it('escapes a double-quote inside arg', () => {
        // "say "hi"" → "say \"hi\""
        const result = escapeWindowsArg('say "hi"')
        expect(result).toContain('\\"')
        expect(result.startsWith('"')).toBe(true)
        expect(result.endsWith('"')).toBe(true)
    })

    it('doubles trailing backslashes before closing quote', () => {
        // "path\" → "path\\" (trailing backslash needs doubling)
        const result = escapeWindowsArg('C:\\path\\')
        expect(result).toBe('"C:\\path\\\\"')
    })

    it('doubles backslashes immediately before a double-quote', () => {
        const result = escapeWindowsArg('a\\"b')
        // backslash before embedded quote → doubled backslash + escaped quote
        expect(result).toContain('\\\\\\"')
    })

    it('wraps path with backslashes in double quotes (conservative quoting)', () => {
        // Backslashes trigger the quoting path; they are preserved as-is
        // since they are not followed by a double-quote character.
        expect(escapeWindowsArg('C:\\Users\\bekk')).toBe('"C:\\Users\\bekk"')
    })

    it('wraps arg containing a tab in double quotes', () => {
        const result = escapeWindowsArg('a\tb')
        expect(result.startsWith('"')).toBe(true)
    })
})

// ─── buildTriggerArgs ─────────────────────────────────────────────────────────

describe('buildTriggerArgs', () => {
    it('builds daily trigger args', () => {
        expect(buildTriggerArgs({ type: 'daily', time: '09:00' })).toEqual([
            '/sc',
            'daily',
            '/st',
            '09:00',
        ])
    })

    it('builds weekly trigger args with uppercased day', () => {
        const result = buildTriggerArgs({ type: 'weekly', day: 'mon', time: '08:30' })
        expect(result).toEqual(['/sc', 'weekly', '/d', 'MON', '/st', '08:30'])
    })

    it('maps all days of week to uppercase abbreviations', () => {
        const days = [
            ['mon', 'MON'],
            ['tue', 'TUE'],
            ['wed', 'WED'],
            ['thu', 'THU'],
            ['fri', 'FRI'],
            ['sat', 'SAT'],
            ['sun', 'SUN'],
        ] as const

        for (const [input, expected] of days) {
            const result = buildTriggerArgs({ type: 'weekly', day: input, time: '00:00' })
            expect(result[3]).toBe(expected)
        }
    })

    it('builds monthly trigger args', () => {
        expect(buildTriggerArgs({ type: 'monthly', day: '15', time: '23:00' })).toEqual([
            '/sc',
            'monthly',
            '/d',
            '15',
            '/st',
            '23:00',
        ])
    })

    it('builds interval trigger args using /sc minute /mo', () => {
        expect(buildTriggerArgs({ type: 'interval', interval: 30 })).toEqual([
            '/sc',
            'minute',
            '/mo',
            '30',
        ])
    })

    it('converts interval to string', () => {
        const result = buildTriggerArgs({ type: 'interval', interval: 5 })
        expect(typeof result[3]).toBe('string')
    })

    it('throws on unknown schedule type', () => {
        expect(() => buildTriggerArgs({ type: 'unknown' as never })).toThrow()
    })
})
