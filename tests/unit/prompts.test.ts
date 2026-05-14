import { describe, expect, it } from 'bun:test'

import { CancelledError } from '../../src/lib/ui/prompts'

describe('CancelledError', () => {
    it('is an Error instance', () => {
        const err = new CancelledError()
        expect(err).toBeInstanceOf(Error)
    })

    it('has correct name', () => {
        const err = new CancelledError()
        expect(err.name).toBe('CancelledError')
    })

    it('has correct message', () => {
        const err = new CancelledError()
        expect(err.message).toBe('Cancelled')
    })
})
