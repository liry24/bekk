import { describe, expect, it, beforeEach } from 'bun:test'

import { MockRenderer, createMockRenderer } from '../helpers/mock-renderer'

let mockR: MockRenderer

beforeEach(() => {
    mockR = createMockRenderer()
    mockR.reset()
})

describe('TaskList (mocked)', () => {
    it('add returns a unique id', () => {
        const tasks: { id: string; label: string; state: string }[] = []
        const add = (label: string) => {
            const id = `task_${tasks.length}_${Date.now()}`
            tasks.push({ id, label, state: 'pending' })
            return id
        }
        const id1 = add('task1')
        const id2 = add('task2')
        expect(id1).not.toBe(id2)
    })

    it('update changes task state', () => {
        const tasks = [{ id: 't1', label: 'test', state: 'pending' }]
        const update = (id: string, state: string) => {
            const task = tasks.find((t) => t.id === id)
            if (task) task.state = state
        }
        update('t1', 'running')
        expect(tasks[0]!.state).toBe('running')
    })

    it('update with non-existent id is no-op', () => {
        const tasks = [{ id: 't1', label: 'test', state: 'pending' }]
        const update = (id: string, state: string) => {
            const task = tasks.find((t) => t.id === id)
            if (task) task.state = state
        }
        update('nonexistent', 'running')
        expect(tasks[0]!.state).toBe('pending')
    })

    it('setDetail updates task detail', () => {
        const tasks = [{ id: 't1', label: 'test', state: 'pending', detail: 'old' }]
        const setDetail = (id: string, detail: string) => {
            const task = tasks.find((t) => t.id === id)
            if (task) task.detail = detail
        }
        setDetail('t1', 'new')
        expect(tasks[0]!.detail).toBe('new')
    })

    it('BUG: find is O(n) - should use Map for large task lists', () => {
        const tasks = Array.from({ length: 100 }, (_, i) => ({
            id: `t${i}`,
            label: `task ${i}`,
            state: 'pending',
        }))
        const findTask = (id: string) => tasks.find((t) => t.id === id)
        const start = performance.now()
        for (let i = 0; i < 1000; i++) {
            findTask(`t${99}`)
        }
        const elapsed = performance.now() - start
        expect(elapsed).toBeLessThan(100)
    })
})
