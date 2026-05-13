import { describe, expect, it } from 'bun:test'

import { buildPlist, escapeXml } from '../../src/lib/scheduler/macos'

// ─── escapeXml ────────────────────────────────────────────────────────────────

describe('escapeXml', () => {
    it('escapes ampersand', () => {
        expect(escapeXml('a&b')).toBe('a&amp;b')
    })

    it('escapes less-than', () => {
        expect(escapeXml('a<b')).toBe('a&lt;b')
    })

    it('escapes greater-than', () => {
        expect(escapeXml('a>b')).toBe('a&gt;b')
    })

    it('escapes double-quote', () => {
        expect(escapeXml('say "hi"')).toBe('say &quot;hi&quot;')
    })

    it('escapes all special chars in one string', () => {
        expect(escapeXml('<a href="x">&amp;</a>')).toBe(
            '&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;',
        )
    })

    it('leaves safe characters unchanged', () => {
        const safe = 'Hello World 123 /path/to/file.txt'
        expect(escapeXml(safe)).toBe(safe)
    })
})

// ─── buildPlist ───────────────────────────────────────────────────────────────

describe('buildPlist', () => {
    const program = '/usr/local/bin/bun'
    const args = ['run', 'backup']

    it('includes program and args in ProgramArguments', () => {
        const plist = buildPlist(program, args, { type: 'daily', time: '09:00' })
        expect(plist).toContain(`<string>${program}</string>`)
        expect(plist).toContain('<string>run</string>')
        expect(plist).toContain('<string>backup</string>')
    })

    it('builds daily plist with StartCalendarInterval (Hour + Minute, no Weekday/Day)', () => {
        const plist = buildPlist(program, args, { type: 'daily', time: '09:30' })
        expect(plist).toContain('<key>StartCalendarInterval</key>')
        expect(plist).toContain('<key>Hour</key>')
        expect(plist).toContain('<integer>9</integer>')
        expect(plist).toContain('<key>Minute</key>')
        expect(plist).toContain('<integer>30</integer>')
        expect(plist).not.toContain('<key>Weekday</key>')
        expect(plist).not.toContain('<key>Day</key>')
        expect(plist).not.toContain('<key>StartInterval</key>')
    })

    it('builds weekly plist with Weekday key (Mon = 1)', () => {
        const plist = buildPlist(program, args, { type: 'weekly', day: 'mon', time: '08:00' })
        expect(plist).toContain('<key>Weekday</key>')
        expect(plist).toContain('<integer>1</integer>')
    })

    it('maps all days of week to correct launchd Weekday integers', () => {
        const expected: Record<string, number> = {
            mon: 1,
            tue: 2,
            wed: 3,
            thu: 4,
            fri: 5,
            sat: 6,
            sun: 0,
        }
        for (const [day, weekday] of Object.entries(expected)) {
            const plist = buildPlist(program, args, { type: 'weekly', day, time: '00:00' })
            // The integer appears somewhere in the plist for Weekday
            expect(plist).toContain(`<integer>${weekday}</integer>`)
        }
    })

    it('builds monthly plist with Day key', () => {
        const plist = buildPlist(program, args, { type: 'monthly', day: '15', time: '23:00' })
        expect(plist).toContain('<key>Day</key>')
        expect(plist).toContain('<integer>15</integer>')
        expect(plist).not.toContain('<key>Weekday</key>')
        expect(plist).not.toContain('<key>StartInterval</key>')
    })

    it('builds interval plist with StartInterval (seconds = interval * 60)', () => {
        const plist = buildPlist(program, args, { type: 'interval', interval: 30 })
        expect(plist).toContain('<key>StartInterval</key>')
        expect(plist).toContain('<integer>1800</integer>') // 30 * 60
        expect(plist).not.toContain('<key>StartCalendarInterval</key>')
    })

    it('escapes special XML chars in program path', () => {
        const specialProgram = '/home/user/my & app/bun'
        const plist = buildPlist(specialProgram, args, { type: 'daily', time: '09:00' })
        expect(plist).toContain('my &amp; app')
        expect(plist).not.toContain('my & app')
    })

    it('contains valid plist DOCTYPE declaration', () => {
        const plist = buildPlist(program, args, { type: 'daily', time: '09:00' })
        expect(plist).toContain('<?xml version="1.0"')
        expect(plist).toContain('<!DOCTYPE plist')
    })
})
