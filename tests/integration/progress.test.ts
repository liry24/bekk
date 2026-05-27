import { describe, expect, it } from 'bun:test'

import { accumulateProgressFrameTime } from '../../src/lib/ui/progress'

describe('Progress redraw throttling', () => {
    it('does not advance the spinner before the redraw interval', () => {
        expect(accumulateProgressFrameTime(10, 20, 80)).toEqual({
            elapsedMs: 30,
            advanced: false,
        })
    })

    it('advances once and preserves remainder once the interval is reached', () => {
        expect(accumulateProgressFrameTime(70, 25, 80)).toEqual({
            elapsedMs: 15,
            advanced: true,
        })
    })
})
