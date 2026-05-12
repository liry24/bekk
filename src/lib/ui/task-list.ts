// ─── task-list.ts ─── Live-updating task list (OpenTUI footer) ───────────────

import {
    StyledText,
    TextRenderable,
    t as styledT,
    dim as otuiDim,
    green as otuiGreen,
    red as otuiRed,
    yellow as otuiYellow,
    type TextChunk,
} from '@opentui/core'

import {
    clearFooter,
    ensureHintIsLast,
    getExtraFooterHeight,
    getRenderer,
    writeScrollback,
} from './renderer'
import { getRandomSpinner } from './spinner'

export type TaskState = 'pending' | 'running' | 'success' | 'error'

interface Task {
    id: string
    label: string
    state: TaskState
    detail?: string
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
    const taskMap = new Map<string, Task>()
    const tasksOrder: string[] = []
    const spinner = getRandomSpinner()
    let frameIdx = 0
    let finished = false
    // Lazily created on first add() to avoid a blank footer line before any tasks exist.
    let text: TextRenderable | null = null

    // ─── Icon / row builders ─────────────────────────────────────────────────
    // These live inside the closure so formatIconChunk can read the current frameIdx.

    const formatIconChunk = (state: TaskState): TextChunk => {
        switch (state) {
            case 'pending':
                return otuiDim('○')
            case 'running':
                return otuiYellow(spinner.frames[frameIdx % spinner.frames.length]!)
            case 'success':
                return otuiGreen('✔')
            case 'error':
                return otuiRed('✖')
        }
    }

    const formatTaskStyled = (task: Task): StyledText => {
        const icon = formatIconChunk(task.state)
        if (task.detail) return styledT`  ${icon} ${task.label}  ${otuiDim(task.detail)}`
        return styledT`  ${icon} ${task.label}`
    }

    // ─── Redraw ──────────────────────────────────────────────────────────────
    // Build a native StyledText so OpenTUI's pixel pipeline sees real glyph
    // widths. Passing an ANSI string would go through stringToStyledText which
    // treats escape bytes as literal characters, causing icons to be invisible
    // and text to appear truncated.

    const redraw = () => {
        if (!text || tasksOrder.length === 0) return
        text.height = tasksOrder.length
        r.footerHeight = tasksOrder.length + getExtraFooterHeight()
        const allChunks: TextChunk[] = []
        for (let i = 0; i < tasksOrder.length; i++) {
            if (i > 0) allChunks.push(styledT`\n`.chunks[0]!)
            const task = taskMap.get(tasksOrder[i]!)!
            allChunks.push(...formatTaskStyled(task).chunks)
        }
        text.content = new StyledText(allChunks)
        r.requestRender()
    }

    // Frame callback: advances the spinner animation and redraws the footer.
    const frameCallback = async (_dt: number) => {
        frameIdx++
        redraw()
    }

    return {
        add(label: string, detail?: string): string {
            const id = `task_${tasksOrder.length}_${Date.now()}`
            taskMap.set(id, { id, label, state: 'pending', detail })
            tasksOrder.push(id)

            // Lazy-init: create the TextRenderable and start live mode on the
            // first add() call so there is never a blank footer line when the
            // task list is created but no tasks have been added yet.
            if (!text) {
                text = new TextRenderable(r, { height: 1, content: '' })
                r.root.add(text)
                ensureHintIsLast(r)
                r.requestLive()
                r.setFrameCallback(frameCallback)
            }

            redraw()
            return id
        },

        update(id: string, state: TaskState, detail?: string): void {
            const task = taskMap.get(id)
            if (!task) return
            task.state = state
            if (detail !== undefined) task.detail = detail
            redraw()
        },

        setDetail(id: string, detail: string): void {
            const task = taskMap.get(id)
            if (!task) return
            task.detail = detail
            redraw()
        },

        render(): void {
            redraw()
        },

        finish(): void {
            if (finished) return
            finished = true
            // Stop the spinner animation before committing final state.
            r.removeFrameCallback(frameCallback)
            r.dropLive()
            // Shrink the footer first so the old footer rows become part of the
            // main scrollback area.  writeToScrollback places items starting
            // just above the new footer, which fills the formerly-blank rows.
            clearFooter(r)
            for (const id of tasksOrder) {
                const task = taskMap.get(id)!
                writeScrollback(formatTaskStyled(task))
            }
        },
    }
}
