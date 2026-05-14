import { describe, expect, it, beforeEach } from 'bun:test'

import { MockRenderer, createMockRenderer } from '../helpers/mock-renderer'

let mockR: MockRenderer

beforeEach(() => {
    mockR = createMockRenderer()
    mockR.reset()
})

describe('Renderer (mocked)', () => {
    it('createMockRenderer returns a renderer', () => {
        expect(mockR).toBeDefined()
        expect(mockR.width).toBe(80)
        expect(mockR.height).toBe(24)
    })

    it('root.add adds children', () => {
        const child = { id: 'test', destroyRecursively: () => {} }
        mockR.root.add(child)
        expect(mockR.getChildren().length).toBe(1)
    })

    it('root.remove removes children', () => {
        const child = { id: 'test', destroyRecursively: () => {} }
        mockR.root.add(child)
        mockR.root.remove('test')
        expect(mockR.getChildren().length).toBe(0)
    })

    it('root.remove non-existent child is no-op', () => {
        mockR.root.remove('nonexistent')
        expect(mockR.getChildren().length).toBe(0)
    })

    it('destroy sets isDestroyed flag', () => {
        mockR.destroy()
        expect(mockR.isDestroyed).toBe(true)
    })

    it('reset clears state', () => {
        mockR.root.add({ id: 'test', destroyRecursively: () => {} })
        mockR.setFrameCallback(async () => {})
        mockR.reset()
        expect(mockR.getChildren().length).toBe(0)
        expect(mockR.isDestroyed).toBe(false)
    })

    it('footerHeight is configurable', () => {
        mockR.footerHeight = 5
        expect(mockR.footerHeight).toBe(5)
    })

    it('clearFooter safely handles focused renderable', () => {
        const focused = {
            id: 'focused',
            destroyRecursively: () => {},
            blur: () => {},
        }
        mockR.currentFocusedRenderable = focused
        mockR.root.add(focused)
        mockR.currentFocusedRenderable = null
        expect(mockR.currentFocusedRenderable).toBeNull()
    })

    it('writeToScrollback records writes', () => {
        const writer = () => ({ root: null })
        mockR.writeToScrollback(writer)
        expect(mockR.getScrollbackWrites().length).toBe(1)
    })

    it('simulateInput calls handlers in order', () => {
        const calls: string[] = []
        mockR.prependInputHandler((seq) => {
            calls.push('first')
            return seq === 'a'
        })
        mockR.prependInputHandler((seq) => {
            calls.push('second')
            return seq === 'b'
        })
        mockR.simulateInput('a')
        expect(calls).toEqual(['second', 'first'])
    })

    it('simulateFrame calls frame callback', () => {
        let frameCount = 0
        mockR.setFrameCallback(async () => {
            frameCount++
        })
        mockR.simulateFrame()
        mockR.simulateFrame()
        expect(frameCount).toBe(2)
    })

    it('removeFrameCallback clears callback', () => {
        let frameCount = 0
        const cb = async () => {
            frameCount++
        }
        mockR.setFrameCallback(cb)
        mockR.removeFrameCallback(cb)
        mockR.simulateFrame()
        expect(frameCount).toBe(0)
    })
})
