// ─── task-list.ts ─── タスクリスト（リアルタイム更新、OpenTUI footer） ──────

import { TextRenderable } from '@opentui/core'

import { clearFooter, ensureHintIsLast, getExtraFooterHeight, getRenderer } from './renderer'
import { dim, green, red, yellow } from './style'

export type TaskState = 'pending' | 'running' | 'success' | 'error'

interface Task {
    id: string
    label: string
    state: TaskState
    detail?: string
}

const formatIcon = (state: TaskState): string => {
    switch (state) {
        case 'pending':
            return dim('○')
        case 'running':
            return yellow('◐')
        case 'success':
            return green('◉')
        case 'error':
            return red('✕')
    }
}

const formatTask = (t: Task): string => {
    const icon = formatIcon(t.state)
    const label = `${icon} ${t.label}`
    if (t.detail) return `${label}  ${dim(t.detail)}`
    return label
}

export interface TaskListInstance {
    add: (label: string, detail?: string) => string
    update: (id: string, state: TaskState, detail?: string) => void
    setDetail: (id: string, detail: string) => void
    render: () => void
    finish: () => void
}

export const createTaskList = async (): Promise<TaskListInstance> => {
    const r = await getRenderer()
    const tasks: Task[] = []

    const text = new TextRenderable(r, { height: 1, content: '' })
    r.root.add(text)
    ensureHintIsLast(r)
    r.footerHeight = 1 + getExtraFooterHeight()
    r.requestRender()

    const redraw = () => {
        if (tasks.length === 0) return
        text.height = tasks.length
        r.footerHeight = tasks.length + getExtraFooterHeight()
        text.content = tasks.map((t) => `  ${formatTask(t)}`).join('\n')
        r.requestRender()
    }

    return {
        add(label: string, detail?: string): string {
            const id = `task_${tasks.length}_${Date.now()}`
            tasks.push({ id, label, state: 'pending', detail })
            redraw()
            return id
        },

        update(id: string, state: TaskState, detail?: string): void {
            const task = tasks.find((t) => t.id === id)
            if (!task) return
            task.state = state
            if (detail !== undefined) task.detail = detail
            redraw()
        },

        setDetail(id: string, detail: string): void {
            const task = tasks.find((t) => t.id === id)
            if (!task) return
            task.detail = detail
            redraw()
        },

        render(): void {
            redraw()
        },

        finish(): void {
            // Print final summary to scrollback then clear footer
            for (const t of tasks) {
                process.stdout.write(`  ${formatTask(t)}\n`)
            }
            clearFooter(r)
        },
    }
}
