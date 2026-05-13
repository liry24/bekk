import { describe, expect, it } from 'bun:test'

import { buildService, buildTimer, escapeSystemdArg } from '../../src/lib/scheduler/linux'

// ─── escapeSystemdArg ─────────────────────────────────────────────────────────

describe('escapeSystemdArg', () => {
    it('returns plain arg unchanged', () => {
        expect(escapeSystemdArg('hello')).toBe('hello')
    })

    it('wraps arg containing a space in double quotes', () => {
        expect(escapeSystemdArg('hello world')).toBe('"hello world"')
    })

    it('escapes dollar sign', () => {
        const result = escapeSystemdArg('$HOME')
        expect(result).toBe('"\\$HOME"')
    })

    it('escapes backtick', () => {
        const result = escapeSystemdArg('a`b')
        expect(result).toBe('"a\\`b"')
    })

    it('escapes double-quote', () => {
        const result = escapeSystemdArg('say "hi"')
        expect(result).toBe('"say \\"hi\\""')
    })

    it('escapes backslash', () => {
        const result = escapeSystemdArg('a\\b')
        expect(result).toBe('"a\\\\b"')
    })

    it('returns /usr/bin/bun unchanged (safe path)', () => {
        expect(escapeSystemdArg('/usr/bin/bun')).toBe('/usr/bin/bun')
    })

    it('wraps path with spaces in quotes', () => {
        const result = escapeSystemdArg('/home/my user/bun')
        expect(result.startsWith('"')).toBe(true)
        expect(result.endsWith('"')).toBe(true)
    })
})

// ─── buildService ─────────────────────────────────────────────────────────────

describe('buildService', () => {
    it('contains [Unit] section', () => {
        expect(buildService('/usr/bin/bun', ['backup'])).toContain('[Unit]')
    })

    it('contains [Service] with Type=oneshot', () => {
        const svc = buildService('/usr/bin/bun', ['backup'])
        expect(svc).toContain('[Service]')
        expect(svc).toContain('Type=oneshot')
    })

    it('contains ExecStart with program', () => {
        const svc = buildService('/usr/bin/bun', ['backup'])
        expect(svc).toContain('ExecStart=/usr/bin/bun backup')
    })

    it('includes all args in ExecStart', () => {
        const svc = buildService('/usr/bin/bun', ['run', 'backup'])
        expect(svc).toContain('ExecStart=/usr/bin/bun run backup')
    })

    it('escapes program path with spaces', () => {
        const svc = buildService('/home/my user/bun', ['backup'])
        expect(svc).toContain('ExecStart=')
        expect(svc).toContain('"/home/my user/bun"')
    })

    it('contains [Install] section', () => {
        expect(buildService('/usr/bin/bun', ['backup'])).toContain('[Install]')
    })
})

// ─── buildTimer ───────────────────────────────────────────────────────────────

describe('buildTimer', () => {
    it('contains [Timer] section', () => {
        expect(buildTimer({ type: 'daily', time: '09:00' })).toContain('[Timer]')
    })

    it('builds interval timer with OnUnitActiveSec', () => {
        const timer = buildTimer({ type: 'interval', interval: 30 })
        expect(timer).toContain('OnUnitActiveSec=30m')
        expect(timer).toContain('OnBootSec=1min')
        expect(timer).not.toContain('OnCalendar')
    })

    it('builds daily timer with OnCalendar *-*-* HH:MM:00', () => {
        const timer = buildTimer({ type: 'daily', time: '09:00' })
        expect(timer).toContain('OnCalendar=*-*-* 09:00:00')
        expect(timer).toContain('Persistent=true')
    })

    it('builds weekly timer with day name prefix', () => {
        const timer = buildTimer({ type: 'weekly', day: 'mon', time: '08:30' })
        expect(timer).toContain('OnCalendar=Mon *-*-* 08:30:00')
    })

    it('maps all days of week to correct systemd day names', () => {
        const expected: Record<string, string> = {
            mon: 'Mon',
            tue: 'Tue',
            wed: 'Wed',
            thu: 'Thu',
            fri: 'Fri',
            sat: 'Sat',
            sun: 'Sun',
        }
        for (const [day, name] of Object.entries(expected)) {
            const timer = buildTimer({ type: 'weekly', day, time: '00:00' })
            expect(timer).toContain(`OnCalendar=${name}`)
        }
    })

    it('builds monthly timer with zero-padded day', () => {
        const timer = buildTimer({ type: 'monthly', day: '1', time: '00:00' })
        expect(timer).toContain('OnCalendar=*-*-01 00:00:00')
    })

    it('builds monthly timer for day 15', () => {
        const timer = buildTimer({ type: 'monthly', day: '15', time: '23:59' })
        expect(timer).toContain('OnCalendar=*-*-15 23:59:00')
    })

    it('contains [Install] with WantedBy=timers.target', () => {
        const timer = buildTimer({ type: 'daily', time: '09:00' })
        expect(timer).toContain('[Install]')
        expect(timer).toContain('WantedBy=timers.target')
    })
})
