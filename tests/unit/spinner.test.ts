import { describe, expect, it } from 'bun:test'

import { getRandomSpinner, getSuccessIcon, getErrorIcon } from '../../src/lib/ui/spinner'
import { green, red } from '../../src/lib/ui/style'

describe('getRandomSpinner', () => {
    it('returns a spinner with frames', () => {
        const spinner = getRandomSpinner()
        expect(spinner.frames.length).toBeGreaterThan(0)
    })

    it('returns cached spinner on subsequent calls', () => {
        const first = getRandomSpinner()
        const second = getRandomSpinner()
        expect(first).toBe(second)
    })

    it('returns a dots-type spinner', () => {
        const spinner = getRandomSpinner()
        expect(spinner.frames[0]).toBeDefined()
        expect(typeof spinner.frames[0]).toBe('string')
    })
})

describe('getSuccessIcon', () => {
    it('returns green checkmark', () => {
        const icon = getSuccessIcon()
        expect(icon).toBe(green('✔'))
    })
})

describe('getErrorIcon', () => {
    it('returns red cross', () => {
        const icon = getErrorIcon()
        expect(icon).toBe(red('✖'))
    })
})
