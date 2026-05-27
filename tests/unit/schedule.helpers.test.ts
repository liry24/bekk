import { describe, expect, it } from 'bun:test'

import type { ScheduleEntry } from '#lib/scheduler'

import {
    buildScheduleInfoOpts,
    formatSchedule,
    nextTaskLabel,
    parseScheduleEntries,
} from '../../src/commands/schedule'

// ─── nextTaskLabel ────────────────────────────────────────────────────────────

describe('nextTaskLabel', () => {
    it('returns bekk-backup-0 when no entries exist', () => {
        expect(nextTaskLabel([])).toBe('bekk-backup-0')
    })

    it('returns index + 1 of existing single entry', () => {
        const entries: ScheduleEntry[] = [
            { label: 'bekk-backup-0', config: { type: 'daily', time: '09:00' } },
        ]
        expect(nextTaskLabel(entries)).toBe('bekk-backup-1')
    })

    it('returns max index + 1 for multiple entries', () => {
        const entries: ScheduleEntry[] = [
            { label: 'bekk-backup-0', config: { type: 'daily', time: '09:00' } },
            { label: 'bekk-backup-2', config: { type: 'interval', interval: 30 } },
        ]
        expect(nextTaskLabel(entries)).toBe('bekk-backup-3')
    })

    it('handles non-sequential indices (gaps)', () => {
        const entries: ScheduleEntry[] = [
            { label: 'bekk-backup-1', config: { type: 'daily', time: '09:00' } },
            { label: 'bekk-backup-5', config: { type: 'daily', time: '12:00' } },
        ]
        expect(nextTaskLabel(entries)).toBe('bekk-backup-6')
    })

    it('treats entries without numeric suffix as index -1', () => {
        const entries: ScheduleEntry[] = [
            { label: 'bekk-backup', config: { type: 'daily', time: '09:00' } },
        ]
        // max(-1) + 1 = 0
        expect(nextTaskLabel(entries)).toBe('bekk-backup-0')
    })
})

// ─── formatSchedule ───────────────────────────────────────────────────────────

describe('formatSchedule', () => {
    it('formats daily schedule', () => {
        expect(formatSchedule({ type: 'daily', time: '09:00' })).toBe('Daily at 09:00')
    })

    it('formats weekly schedule', () => {
        expect(formatSchedule({ type: 'weekly', day: 'mon', time: '08:30' })).toBe(
            'Weekly on mon at 08:30',
        )
    })

    it('formats monthly schedule', () => {
        expect(formatSchedule({ type: 'monthly', day: '15', time: '23:00' })).toBe(
            'Monthly on day 15 at 23:00',
        )
    })

    it('formats interval schedule', () => {
        expect(formatSchedule({ type: 'interval', interval: 30 })).toBe('Every 30 minutes')
    })
})

// ─── buildScheduleInfoOpts ────────────────────────────────────────────────────

describe('buildScheduleInfoOpts', () => {
    it('returns daily opts', () => {
        expect(buildScheduleInfoOpts({ type: 'daily', time: '09:00' })).toEqual({ daily: '09:00' })
    })

    it('returns weekly opts as tuple [day, time]', () => {
        const result = buildScheduleInfoOpts({ type: 'weekly', day: 'fri', time: '17:00' })
        expect(result).toEqual({ weekly: ['fri', '17:00'] })
    })

    it('returns monthly opts as tuple [day, time]', () => {
        const result = buildScheduleInfoOpts({ type: 'monthly', day: '1', time: '00:00' })
        expect(result).toEqual({ monthly: ['1', '00:00'] })
    })

    it('returns interval opts', () => {
        expect(buildScheduleInfoOpts({ type: 'interval', interval: 60 })).toEqual({ interval: 60 })
    })
})

// ─── parseScheduleEntries ─────────────────────────────────────────────────────

describe('parseScheduleEntries', () => {
    it('returns [] for empty string', () => {
        expect(parseScheduleEntries('')).toEqual([])
    })

    it('returns [] for "{}"  (legacy empty sentinel)', () => {
        expect(parseScheduleEntries('{}')).toEqual([])
    })

    it('returns [] for "[]" (empty array)', () => {
        expect(parseScheduleEntries('[]')).toEqual([])
    })

    it('returns [] for invalid JSON', () => {
        expect(parseScheduleEntries('not-json')).toEqual([])
    })

    it('returns entries as-is when stored as an array', () => {
        const entries: ScheduleEntry[] = [
            { label: 'bekk-backup-0', config: { type: 'daily', time: '09:00' } },
            { label: 'bekk-backup-1', config: { type: 'interval', interval: 60 } },
        ]
        expect(parseScheduleEntries(JSON.stringify(entries))).toEqual(entries)
    })

    it('drops malformed remote entries from stored arrays', () => {
        const raw = JSON.stringify([
            { label: 'bekk-backup-0', config: { type: 'daily', time: '09:00' } },
            { label: '../../evil', config: { type: 'daily', time: '09:00' } },
            { label: 'bekk-backup-1', config: { type: 'daily', time: '25:00' } },
            { label: 'bekk-backup-2', config: { type: 'interval', interval: 0 } },
            { label: 'bekk-backup-3', config: { type: 'interval', interval: 15 } },
        ])

        expect(parseScheduleEntries(raw)).toEqual([
            { label: 'bekk-backup-0', config: { type: 'daily', time: '09:00' } },
            { label: 'bekk-backup-3', config: { type: 'interval', interval: 15 } },
        ])
    })

    it('migrates legacy single-object format into array with label bekk-backup-0', () => {
        const legacy = JSON.stringify({ type: 'daily', time: '09:00' })
        const result = parseScheduleEntries(legacy)
        expect(result).toHaveLength(1)
        expect(result[0]!.label).toBe('bekk-backup-0')
        expect(result[0]!.config).toEqual({ type: 'daily', time: '09:00' })
    })

    it('migrates legacy weekly single-object', () => {
        const legacy = JSON.stringify({ type: 'weekly', day: 'mon', time: '08:00' })
        const result = parseScheduleEntries(legacy)
        expect(result).toHaveLength(1)
        expect(result[0]!.config.type).toBe('weekly')
    })

    it('migrates legacy interval single-object', () => {
        const legacy = JSON.stringify({ type: 'interval', interval: 30 })
        const result = parseScheduleEntries(legacy)
        expect(result).toHaveLength(1)
        expect(result[0]!.config.type).toBe('interval')
        expect((result[0]!.config as { type: 'interval'; interval: number }).interval).toBe(30)
    })

    it('returns [] for a plain object without "type" key', () => {
        expect(parseScheduleEntries('{"foo":"bar"}')).toEqual([])
    })

    it('does not migrate invalid legacy single-object schedules', () => {
        expect(parseScheduleEntries(JSON.stringify({ type: 'daily', time: '24:00' }))).toEqual([])
        expect(
            parseScheduleEntries(JSON.stringify({ type: 'weekly', day: '../x', time: '09:00' })),
        ).toEqual([])
        expect(parseScheduleEntries(JSON.stringify({ type: 'interval', interval: -1 }))).toEqual([])
    })
})
