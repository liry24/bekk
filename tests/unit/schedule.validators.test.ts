import { describe, expect, it } from 'bun:test'

import {
    validateDayOfMonth,
    validateDayOfWeek,
    validateInterval,
    validateTime,
} from '../../src/commands/schedule'

// ─── validateTime ─────────────────────────────────────────────────────────────

describe('validateTime', () => {
    it('accepts midnight (0:00)', () => {
        expect(validateTime('0:00')).toBe(true)
    })

    it('accepts last minute of day (23:59)', () => {
        expect(validateTime('23:59')).toBe(true)
    })

    it('accepts zero-padded hours (09:30)', () => {
        expect(validateTime('09:30')).toBe(true)
    })

    it('rejects hour > 23', () => {
        const result = validateTime('24:00')
        expect(result).not.toBe(true)
        expect(typeof result).toBe('string')
    })

    it('rejects minute > 59', () => {
        const result = validateTime('12:60')
        expect(result).not.toBe(true)
        expect(typeof result).toBe('string')
    })

    it('rejects non-numeric input', () => {
        expect(validateTime('abc')).not.toBe(true)
    })

    it('rejects missing colon', () => {
        expect(validateTime('1200')).not.toBe(true)
    })

    it('rejects empty string', () => {
        expect(validateTime('')).not.toBe(true)
    })

    it('rejects negative hours', () => {
        // "-1:00" does not match /^\d{1,2}:\d{2}$/
        expect(validateTime('-1:00')).not.toBe(true)
    })
})

// ─── validateDayOfWeek ───────────────────────────────────────────────────────

describe('validateDayOfWeek', () => {
    const valid = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

    for (const day of valid) {
        it(`accepts lowercase "${day}"`, () => {
            expect(validateDayOfWeek(day)).toBe(true)
        })

        it(`accepts uppercase "${day.toUpperCase()}"`, () => {
            expect(validateDayOfWeek(day.toUpperCase())).toBe(true)
        })

        it(`accepts mixed-case "${day[0]!.toUpperCase() + day.slice(1)}"`, () => {
            expect(validateDayOfWeek(day[0]!.toUpperCase() + day.slice(1))).toBe(true)
        })
    }

    it('rejects "monday" (full name)', () => {
        expect(validateDayOfWeek('monday')).not.toBe(true)
    })

    it('rejects "8"', () => {
        expect(validateDayOfWeek('8')).not.toBe(true)
    })

    it('rejects empty string', () => {
        expect(validateDayOfWeek('')).not.toBe(true)
    })
})

// ─── validateDayOfMonth ──────────────────────────────────────────────────────

describe('validateDayOfMonth', () => {
    it('accepts minimum boundary (1)', () => {
        expect(validateDayOfMonth('1')).toBe(true)
    })

    it('accepts maximum boundary (31)', () => {
        expect(validateDayOfMonth('31')).toBe(true)
    })

    it('accepts mid-range (15)', () => {
        expect(validateDayOfMonth('15')).toBe(true)
    })

    it('rejects 0', () => {
        expect(validateDayOfMonth('0')).not.toBe(true)
    })

    it('rejects 32', () => {
        expect(validateDayOfMonth('32')).not.toBe(true)
    })

    it('rejects negative number', () => {
        expect(validateDayOfMonth('-1')).not.toBe(true)
    })

    it('rejects decimal', () => {
        expect(validateDayOfMonth('1.5')).not.toBe(true)
    })

    it('rejects non-numeric', () => {
        expect(validateDayOfMonth('abc')).not.toBe(true)
    })

    it('rejects empty string', () => {
        expect(validateDayOfMonth('')).not.toBe(true)
    })
})

// ─── validateInterval ────────────────────────────────────────────────────────

describe('validateInterval', () => {
    it('accepts 1 (minimum)', () => {
        expect(validateInterval('1')).toBe(true)
    })

    it('accepts 60', () => {
        expect(validateInterval('60')).toBe(true)
    })

    it('accepts 1440 (24h)', () => {
        expect(validateInterval('1440')).toBe(true)
    })

    it('rejects 0', () => {
        expect(validateInterval('0')).not.toBe(true)
    })

    it('rejects negative', () => {
        expect(validateInterval('-5')).not.toBe(true)
    })

    it('rejects decimal', () => {
        expect(validateInterval('1.5')).not.toBe(true)
    })

    it('rejects non-numeric', () => {
        expect(validateInterval('abc')).not.toBe(true)
    })

    it('rejects empty string', () => {
        expect(validateInterval('')).not.toBe(true)
    })
})
