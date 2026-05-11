// ─── prompts.ts ─── Interactive prompts built on OpenTUI ─────────────────────

import {
    InputRenderable,
    InputRenderableEvents,
    SelectRenderable,
    SelectRenderableEvents,
    TextRenderable,
} from '@opentui/core'

import { getRenderer, clearFooter } from './renderer'
import { getRandomSpinner } from './spinner'
import { dim, bold } from './style'

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

    return new Promise<string>((resolve, reject) => {
        const cancelHandler = withCancelHandler(r, reject)

        const label = new TextRenderable(r, { height: 1, content: `  ${bold(options.message)}  ` })
        const field = new InputRenderable(r, {
            flexGrow: 1,
            value: options.default ?? '',
            placeholder: options.placeholder ?? '',
        })
        const hint = new TextRenderable(r, { height: 1, content: '' })

        r.root.add(label)
        r.root.add(field)
        r.root.add(hint)
        r.footerHeight = 3
        r.focusRenderable(field)
        r.requestRender()

        const onEnter = async () => {
            const val = field.value
            const validation = options.validate ? await options.validate(val) : true
            if (validation !== true) {
                hint.content = `  ${dim(validation)}`
                r.requestRender()
                return
            }
            r.removeInputHandler(cancelHandler)
            clearFooter(r)
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

    return new Promise<string>((resolve, reject) => {
        const cancelHandler = withCancelHandler(r, reject)

        let value = ''

        const label = new TextRenderable(r, {
            height: 1,
            content: `  ${bold(options.message)}  `,
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
            // Ctrl+C / Escape already handled by cancelHandler which runs first
            if (seq === '\r' || seq === '\n') {
                const validation = options.validate ? options.validate(value) : true
                if (validation !== true) {
                    hint.content = `  ${dim(validation)}`
                    r.requestRender()
                    return true
                }
                r.removeInputHandler(cancelHandler)
                r.removeInputHandler(keyHandler)
                clearFooter(r)
                resolve(value)
                return true
            }
            if (seq === '\x7f' || seq === '\b') {
                value = value.slice(0, -1)
                refresh()
                return true
            }
            // Printable chars only
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

export const confirm = async (options: ConfirmOptions): Promise<boolean> => {
    const r = await getRenderer()

    return new Promise<boolean>((resolve, reject) => {
        const cancelHandler = withCancelHandler(r, reject)

        const active = options.active ?? 'Yes'
        const inactive = options.inactive ?? 'No'
        let current = options.default ?? true

        const text = new TextRenderable(r, { height: 2, content: '' })

        const refresh = () => {
            const yes = current ? bold(`› ${active}`) : `  ${active}`
            const no = !current ? bold(`› ${inactive}`) : `  ${inactive}`
            text.content = `  ${bold(options.message)}\n${yes}   ${no}`
            r.requestRender()
        }

        r.root.add(text)
        r.footerHeight = 2
        refresh()

        const keyHandler = (seq: string): boolean => {
            if (seq === '\r' || seq === '\n') {
                r.removeInputHandler(cancelHandler)
                r.removeInputHandler(keyHandler)
                clearFooter(r)
                resolve(current)
                return true
            }
            if (seq === '\x1b[A' || seq === '\x1b[D' || seq === '\x1b[B' || seq === '\x1b[C') {
                current = !current
                refresh()
                return true
            }
            if (seq === 'y' || seq === 'Y') {
                current = true
                refresh()
                return true
            }
            if (seq === 'n' || seq === 'N') {
                current = false
                refresh()
                return true
            }
            return false
        }
        r.prependInputHandler(keyHandler)
    })
}

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
}

export const select = async <T = string>(options: SelectOptions<T>): Promise<T> => {
    const r = await getRenderer()

    return new Promise<T>((resolve, reject) => {
        const cancelHandler = withCancelHandler(r, reject)

        const selectOptions = options.choices.map((c) => ({
            name: c.label,
            description: c.hint ?? '',
            value: c.value,
        }))

        const defaultIdx =
            options.default !== undefined
                ? options.choices.findIndex((c) => c.value === options.default)
                : 0

        const label = new TextRenderable(r, { height: 1, content: `  ${bold(options.message)}` })
        const sel = new SelectRenderable(r, {
            options: selectOptions,
            selectedIndex: defaultIdx >= 0 ? defaultIdx : 0,
            height: Math.min(options.choices.length, 10),
            showDescription: true,
            wrapSelection: true,
        })

        r.root.add(label)
        r.root.add(sel)
        r.footerHeight = 1 + Math.min(options.choices.length, 10)
        r.focusRenderable(sel)
        r.requestRender()

        sel.on(SelectRenderableEvents.ITEM_SELECTED, () => {
            const opt = sel.getSelectedOption()
            r.removeInputHandler(cancelHandler)
            clearFooter(r)
            resolve(opt?.value as T)
        })
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

    return new Promise<T[]>((resolve, reject) => {
        const cancelHandler = withCancelHandler(r, reject)

        const selected = new Set<number>(
            (options.default ?? [])
                .map((d) => options.choices.findIndex((c) => c.value === d))
                .filter((i) => i >= 0),
        )

        let cursor = 0
        const count = options.choices.length
        const visibleLines = Math.min(count, 10)

        const label = new TextRenderable(r, { height: 1, content: `  ${bold(options.message)}` })
        const body = new TextRenderable(r, { height: visibleLines, content: '' })
        const footer = new TextRenderable(r, {
            height: 1,
            content: dim('  ↑↓ move  Space select  Enter confirm'),
        })

        r.root.add(label)
        r.root.add(body)
        r.root.add(footer)
        r.footerHeight = 1 + visibleLines + 1
        r.requestRender()

        const refresh = () => {
            const lines: string[] = []
            for (let i = 0; i < count; i++) {
                const choice = options.choices[i]!
                const isCursor = i === cursor
                const isSel = selected.has(i)
                const check = isSel ? '[x]' : '[ ]'
                const arrow = isCursor ? '›' : ' '
                const hint = choice.hint ? dim(`  ${choice.hint}`) : ''
                const label = isCursor
                    ? bold(`${arrow} ${check} ${choice.label}`)
                    : `${arrow} ${check} ${choice.label}`
                lines.push(`  ${label}${hint}`)
            }
            body.content = lines.join('\n')
            r.requestRender()
        }
        refresh()

        const keyHandler = (seq: string): boolean => {
            if (seq === '\r' || seq === '\n') {
                r.removeInputHandler(cancelHandler)
                r.removeInputHandler(keyHandler)
                clearFooter(r)
                const result = Array.from(selected)
                    .sort((a, b) => a - b)
                    .map((i) => options.choices[i]!.value)
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

    const text = new TextRenderable(r, { height: 1, content: '' })
    r.root.add(text)
    r.footerHeight = 1

    let frameIdx = 0
    let currentMessage = options.message

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
        await options.task({ updateMessage })
        // Print final state to scrollback
        const frame = sp.frames[frameIdx % sp.frames.length]!
        process.stdout.write(`  ${frame} ${currentMessage}\n`)
    } finally {
        r.removeFrameCallback(frameCallback)
        r.dropLive()
        clearFooter(r)
    }
}
