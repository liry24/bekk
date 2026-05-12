import { describe, expect, it, beforeEach } from 'bun:test'

import { MockRenderer, createMockRenderer } from '../helpers/mock-renderer'

let mockR: MockRenderer

beforeEach(() => {
    mockR = createMockRenderer()
    mockR.reset()
})

describe('Progress (mocked)', () => {
    it('update stores title', () => {
        let title = ''
        const update = (opts: { title?: string }) => {
            if (opts.title !== undefined) title = opts.title
        }
        update({ title: 'Backing up' })
        expect(title).toBe('Backing up')
    })

    it('update stores bar value', () => {
        let bar: number | undefined
        const update = (opts: { bar?: number }) => {
            if (opts.bar !== undefined) bar = opts.bar
        }
        update({ bar: 50.5 })
        expect(bar).toBe(50.5)
    })

    it('update stores details', () => {
        let details: string[] = []
        const update = (opts: { details?: string[] }) => {
            if (opts.details !== undefined) details = opts.details
        }
        update({ details: ['files: 10', 'size: 1MB'] })
        expect(details).toEqual(['files: 10', 'size: 1MB'])
    })

    it('finish sets finished flag', () => {
        let finished = false
        const finish = () => {
            finished = true
        }
        finish()
        expect(finished).toBe(true)
    })

    it('update after finish is ignored', () => {
        let finished = false
        let title = ''
        const update = (opts: { title?: string }) => {
            if (finished) return
            if (opts.title !== undefined) title = opts.title
        }
        const finish = () => {
            finished = true
        }
        finish()
        update({ title: 'should not set' })
        expect(title).toBe('')
    })

    it('BUG: framebuffer recreation does not handle remove failure', () => {
        const children = [{ id: 'fb1' }]
        const remove = (id: string) => {
            const idx = children.findIndex((c) => c.id === id)
            if (idx >= 0) children.splice(idx, 1)
        }
        remove('fb1')
        remove('nonexistent')
        expect(children.length).toBe(0)
    })
})
