// ─── task-list.ts ─── タスクリスト（リアルタイム更新） ─────────────────────

import { dim, green, red, yellow } from '@crustjs/style'

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

export interface TaskListInstance {
    add: (label: string, detail?: string) => string
    update: (id: string, state: TaskState, detail?: string) => void
    setDetail: (id: string, detail: string) => void
    render: () => void
    finish: () => void
}

export const createTaskList = (): TaskListInstance => {
    const tasks: Task[] = []
    let renderedLines = 0

    const formatTask = (t: Task): string => {
        const icon = formatIcon(t.state)
        const prefix = `${icon} ${t.label}`
        if (t.detail) {
            return `${prefix}\n    ${dim(t.detail)}`
        }
        return prefix
    }

    const redraw = (lines: string[]): void => {
        if (renderedLines > 0) {
            process.stdout.write(`\x1b[${renderedLines}A`)
        }

        let totalLines = 0
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (!line) continue
            const subLines = line.split('\n')
            for (let j = 0; j < subLines.length; j++) {
                const sub = subLines[j]
                if (sub === undefined) continue
                if (totalLines > 0) process.stdout.write('\n')
                process.stdout.write('\x1b[2K\x1b[0G')
                process.stdout.write(sub)
                totalLines++
            }
        }

        if (renderedLines > totalLines) {
            for (let i = totalLines; i < renderedLines; i++) {
                process.stdout.write('\n')
                process.stdout.write('\x1b[2K\x1b[0G')
            }
            process.stdout.write(`\x1b[${renderedLines - totalLines}A`)
        }

        process.stdout.write('\n')
        renderedLines = totalLines
    }

    return {
        add(label: string, detail?: string): string {
            const id = `task_${tasks.length}_${Date.now()}`
            tasks.push({ id, label, state: 'pending', detail })
            this.render()
            return id
        },

        update(id: string, state: TaskState, detail?: string): void {
            const task = tasks.find((t) => t.id === id)
            if (!task) return
            task.state = state
            if (detail !== undefined) task.detail = detail
            this.render()
        },

        setDetail(id: string, detail: string): void {
            const task = tasks.find((t) => t.id === id)
            if (!task) return
            task.detail = detail
            this.render()
        },

        render(): void {
            const lines = tasks.map((t) => formatTask(t))
            redraw(lines)
        },

        finish(): void {
            this.render()
            renderedLines = 0
        },
    }
}
