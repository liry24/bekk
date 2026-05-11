// ─── prompts.ts ─── Interactive prompts built on OpenTUI ─────────────────────

import {
    InputRenderable,
    InputRenderableEvents,
    SelectRenderable,
    SelectRenderableEvents,
    TextRenderable,
} from '@opentui/core'

import { getRenderer, clearFooter, writeString } from './renderer'
import { getRandomSpinner } from './spinner'

// ─── CancelledError ──────────────────────────────────────────────────────────

export class CancelledError extends Error {
    constructor() {
        super('Cancelled')
        this.name = 'CancelledError'
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Install a Ctrl+C / Escape interceptor that throws CancelledError. */
const withCancelHandler = (
    r: Awaited<ReturnType<typeof getRenderer>>,
    reject: (err: unknown) => void,
): ((seq: string) => boolean) => {
    const handler = (seq: string): boolean => {
        if (seq === '\x03' || seq === '\x1b') {
            reject(new CancelledError())
            return true
        }
        return false
    }
    r.prependInputHandler(handler)
    return handler
}

// ─── input ───────────────────────────────────────────────────────────────────

export interface InputOptions {
    message: string
    default?: string
    placeholder?: string
    validate?: (value: string) => true | string | Promise<true | string>
}

export const input = async (options: InputOptions): Promise<string> => {
    const r = await getRenderer()
    const { message, default: defaultValue, placeholder, validate } = options

    return new Promise<string>((resolve, reject) => {
        let settled = false
        const cleanup = () => {
            if (settled) return
            settled = true
            r.removeInputHandler(cancelHandler)
            clearFooter(r)
        }

        const cancelHandler = withCancelHandler(r, (err) => {
            cleanup()
            reject(err)
        })

        const label = new TextRenderable(r, { height: 1, content: `  ${message}  ` })
        const field = new InputRenderable(r, {
            flexGrow: 1,
            value: defaultValue ?? '',
            placeholder: placeholder ?? '',
        })
        const hint = new TextRenderable(r, { height: 1, content: '' })

        r.root.add(label)
        r.root.add(field)
        r.root.add(hint)
        r.footerHeight = 3
        field.focus()
        r.requestRender()

        const onEnter = async () => {
            const val = field.value
            const validation = validate ? await validate(val) : true
            if (validation !== true) {
                hint.content = `  ${validation}`
                r.requestRender()
                return
            }
            cleanup()
            resolve(val)
        }

        field.on(InputRenderableEvents.ENTER, onEnter)
    })
}

// ─── password ────────────────────────────────────────────────────────────────

export interface PasswordOptions {
    message: string
    validate?: (value: string) => true | string
}

export const password = async (options: PasswordOptions): Promise<string> => {
    const r = await getRenderer()
    const { message, validate } = options

    return new Promise<string>((resolve, reject) => {
        let settled = false
        let value = ''

        const cleanup = () => {
            if (settled) return
            settled = true
            r.removeInputHandler(cancelHandler)
            r.removeInputHandler(keyHandler)
            clearFooter(r)
        }

        const cancelHandler = withCancelHandler(r, (err) => {
            cleanup()
            reject(err)
        })

        const label = new TextRenderable(r, {
            height: 1,
            content: `  ${message}  `,
        })
        const display = new TextRenderable(r, { height: 1, content: '  ' })
        const hint = new TextRenderable(r, { height: 1, content: '' })

        r.root.add(label)
        r.root.add(display)
        r.root.add(hint)
        r.footerHeight = 3
        r.requestRender()

        const refresh = () => {
            display.content = '  ' + '*'.repeat(value.length)
            r.requestRender()
        }

        const keyHandler = (seq: string): boolean => {
            if (seq === '\r' || seq === '\n') {
                const validation = validate ? validate(value) : true
                if (validation !== true) {
                    hint.content = `  ${validation}`
                    r.requestRender()
                    return true
                }
                cleanup()
                resolve(value)
                return true
            }
            if (seq === '\x7f' || seq === '\b') {
                value = value.slice(0, -1)
                refresh()
                return true
            }
            if (seq.length === 1 && seq >= ' ') {
                value += seq
                refresh()
                return true
            }
            return false
        }
        r.prependInputHandler(keyHandler)
        refresh()
    })
}

// ─── confirm ─────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
    message: string
    default?: boolean
    active?: string
    inactive?: string
}

export const confirm = async (options: ConfirmOptions) =>
    select<boolean>({
        message: options.message,
        choices: [
            { label: options.active ?? 'Yes', value: true },
            { label: options.inactive ?? 'No', value: false },
        ],
        default: options.default ?? true,
    })

// ─── select ──────────────────────────────────────────────────────────────────

export interface SelectChoice<T> {
    label: string
    value: T
    hint?: string
}

export interface SelectOptions<T> {
    message: string
    choices: SelectChoice<T>[]
    default?: T
    showDescription?: boolean
    wrapSelection?: boolean
}

export const select = async <T = string>(options: SelectOptions<T>): Promise<T> => {
    const r = await getRenderer()
    const {
        message,
        choices,
        default: defaultValue,
        showDescription = true,
        wrapSelection = true,
    } = options

    return new Promise<T>((resolve, reject) => {
        let settled = false
        const cleanup = () => {
            if (settled) return
            settled = true
            r.removeInputHandler(cancelHandler)
            clearFooter(r)
        }

        const cancelHandler = withCancelHandler(r, (err) => {
            cleanup()
            reject(err)
        })

        const selectOptions = choices.map((c) => ({
            name: c.label,
            description: c.hint ?? '',
            value: c.value,
        }))

        const defaultIdx =
            defaultValue !== undefined ? choices.findIndex((c) => c.value === defaultValue) : 0

        const label = new TextRenderable(r, { height: 1, content: `  ${message}` })
        const sel = new SelectRenderable(r, {
            options: selectOptions,
            selectedIndex: defaultIdx >= 0 ? defaultIdx : 0,
            width: r.width,
            height: Math.min(choices.length, 10),
            showDescription,
            wrapSelection,
        })

        r.root.add(label)
        r.root.add(sel)
        r.footerHeight = 1 + Math.min(choices.length, 10)
        sel.focus()
        r.requestRender()

        const onSelect = () => {
            const opt = sel.getSelectedOption()
            cleanup()
            resolve(opt?.value as T)
        }

        sel.on(SelectRenderableEvents.ITEM_SELECTED, onSelect)
    })
}

// ─── multiselect ─────────────────────────────────────────────────────────────

export interface MultiselectOptions<T> {
    message: string
    choices: SelectChoice<T>[]
    default?: T[]
}

export const multiselect = async <T = string>(options: MultiselectOptions<T>): Promise<T[]> => {
    const r = await getRenderer()
    const { message, choices, default: defaultValue } = options

    return new Promise<T[]>((resolve, reject) => {
        let settled = false
        const selected = new Set<number>(
            (defaultValue ?? [])
                .map((d) => choices.findIndex((c) => c.value === d))
                .filter((i) => i >= 0),
        )

        let cursor = 0
        const count = choices.length
        const visibleLines = Math.min(count, 10)

        const cleanup = () => {
            if (settled) return
            settled = true
            r.removeInputHandler(cancelHandler)
            r.removeInputHandler(keyHandler)
            clearFooter(r)
        }

        const cancelHandler = withCancelHandler(r, (err) => {
            cleanup()
            reject(err)
        })

        const label = new TextRenderable(r, { height: 1, content: `  ${message}` })
        const body = new TextRenderable(r, { height: visibleLines, content: '' })
        const footer = new TextRenderable(r, {
            height: 1,
            content: '  ↑↓ move  Space select  Enter confirm',
        })

        r.root.add(label)
        r.root.add(body)
        r.root.add(footer)
        r.footerHeight = 1 + visibleLines + 1
        r.requestRender()

        const refresh = () => {
            const lines: string[] = []
            for (let i = 0; i < count; i++) {
                const choice = choices[i]!
                const isCursor = i === cursor
                const isSel = selected.has(i)
                const check = isSel ? '[x]' : '[ ]'
                const arrow = isCursor ? '>' : ' '
                const hint = choice.hint ? `  ${choice.hint}` : ''
                const lbl = isCursor
                    ? `${arrow} ${check} ${choice.label}`
                    : `${arrow} ${check} ${choice.label}`
                lines.push(`  ${lbl}${hint}`)
            }
            body.content = lines.join('\n')
            r.requestRender()
        }
        refresh()

        const keyHandler = (seq: string): boolean => {
            if (seq === '\r' || seq === '\n') {
                cleanup()
                const result = Array.from(selected)
                    .sort((a, b) => a - b)
                    .map((i) => choices[i]!.value)
                resolve(result)
                return true
            }
            if (seq === '\x1b[A') {
                // up
                cursor = (cursor - 1 + count) % count
                refresh()
                return true
            }
            if (seq === '\x1b[B') {
                // down
                cursor = (cursor + 1) % count
                refresh()
                return true
            }
            if (seq === ' ') {
                if (selected.has(cursor)) selected.delete(cursor)
                else selected.add(cursor)
                refresh()
                return true
            }
            return false
        }
        r.prependInputHandler(keyHandler)
    })
}

// ─── spinner ─────────────────────────────────────────────────────────────────

export interface SpinnerOptions {
    message: string
    task: (ctx: { updateMessage: (msg: string) => void }) => Promise<void>
}

export const spinner = async (options: SpinnerOptions): Promise<void> => {
    const r = await getRenderer()
    const sp = getRandomSpinner()
    const { message, task } = options

    const text = new TextRenderable(r, { height: 1, content: '' })
    r.root.add(text)
    r.footerHeight = 1

    let frameIdx = 0
    let currentMessage = message

    const updateMessage = (msg: string) => {
        currentMessage = msg
    }

    const frameCallback = async (_dt: number) => {
        const frame = sp.frames[frameIdx % sp.frames.length]!
        text.content = `  ${frame} ${currentMessage}`
        frameIdx++
        r.requestRender()
    }

    r.requestLive()
    r.setFrameCallback(frameCallback)

    try {
        await task({ updateMessage })
        const frame = sp.frames[frameIdx % sp.frames.length]!
        writeString(`  ${frame} ${currentMessage}`)
    } finally {
        r.removeFrameCallback(frameCallback)
        r.dropLive()
        clearFooter(r)
    }
}
