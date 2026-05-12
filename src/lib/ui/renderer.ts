// ─── renderer.ts ─── OpenTUI singleton + footer helpers ─────────────────────

import {
    createCliRenderer,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
    type StyledText,
} from '@opentui/core'

let _renderer: CliRenderer | null = null
let _initPromise: Promise<CliRenderer> | null = null
let _hintLine: TextRenderable | null = null
let _extraFooterHeight = 0
let _hintTimer: ReturnType<typeof setTimeout> | null = null
// Tracks the highest footer height ever set. Used to ensure the terminal is
// scrolled enough so the footer never overwrites content above its starting line.
let _maxFooterHeight = 1

/** Write raw newlines directly to the terminal (passthrough mode) to scroll
 *  the display area downward. This creates space at the bottom so the footer
 *  can expand without overwriting previous command output. */
const scrollTerminal = (lines: number): void => {
    if (lines <= 0) return
    if (_renderer && !_renderer.isDestroyed) {
        try {
            const prevMode = _renderer.externalOutputMode
            _renderer.externalOutputMode = 'passthrough'
            process.stdout.write('\n'.repeat(lines))
            _renderer.externalOutputMode = prevMode
            return
        } catch {
            // fall through
        }
    }
    process.stdout.write('\n'.repeat(lines))
}

/** Safely increase the footer height. If the new height exceeds the previous
 *  maximum, scrolls the terminal first so the footer expands into fresh space
 *  rather than overwriting command output above. */
export const setFooterHeight = (r: CliRenderer, height: number): void => {
    const newHeight = Math.max(1, height)
    if (newHeight > _maxFooterHeight) {
        scrollTerminal(newHeight - _maxFooterHeight)
        _maxFooterHeight = newHeight
    }
    r.footerHeight = newHeight
}

export const getExtraFooterHeight = (): number => _extraFooterHeight

export const ensureHintIsLast = (r: CliRenderer): void => {
    if (!_hintLine) return
    r.root.remove(_hintLine.id)
    r.root.add(_hintLine)
}

const showHint = (r: CliRenderer, msg: string): void => {
    if (_hintLine) {
        _hintLine.content = msg
        return
    }
    _hintLine = new TextRenderable(r, { height: 1, content: msg })
    r.root.add(_hintLine)
    _extraFooterHeight = 1
    r.footerHeight += 1
    r.requestRender()
}

const hideHint = (r: CliRenderer): void => {
    if (!_hintLine) return
    r.root.remove(_hintLine.id)
    _hintLine.destroyRecursively()
    _hintLine = null
    _extraFooterHeight = 0
    r.footerHeight = Math.max(1, r.footerHeight - 1)
    r.requestRender()
}

export const getRenderer = (): Promise<CliRenderer> => {
    if (_renderer) return Promise.resolve(_renderer)
    if (_initPromise) return _initPromise

    // Scroll the terminal before creating the renderer so the footer has
    // dedicated space at the bottom and never overwrites command output above.
    scrollTerminal(2)

    _initPromise = createCliRenderer({
        screenMode: 'split-footer',
        externalOutputMode: 'capture-stdout',
        exitOnCtrlC: false,
        useKittyKeyboard: null,
        footerHeight: 1,
        consoleMode: 'disabled',
        clearOnShutdown: false,
        useMouse: false,
    }).then((r) => {
        _renderer = r
        r.root.flexDirection = 'column'

        let ctrlCPressedAt: number | null = null
        const CTRL_C_TIMEOUT_MS = 3000

        r.keyInput.on('keypress', (key: KeyEvent) => {
            if (!key.ctrl || key.name !== 'c') return

            const now = Date.now()
            if (ctrlCPressedAt !== null && now - ctrlCPressedAt < CTRL_C_TIMEOUT_MS) {
                if (_hintTimer !== null) {
                    clearTimeout(_hintTimer)
                    _hintTimer = null
                }
                destroyRenderer()
                process.exit(130)
            }

            ctrlCPressedAt = now
            if (_hintTimer !== null) clearTimeout(_hintTimer)
            _hintTimer = setTimeout(() => {
                ctrlCPressedAt = null
                _hintTimer = null
                hideHint(r)
            }, CTRL_C_TIMEOUT_MS)

            showHint(r, '  Press Ctrl+C again to exit.')
        })

        return r
    })

    return _initPromise
}

export const clearFooter = (r: CliRenderer): void => {
    if (_hintTimer !== null) {
        clearTimeout(_hintTimer)
        _hintTimer = null
    }
    _hintLine = null
    _extraFooterHeight = 0

    // Blur any focused renderable before clearing children so the native
    // renderer does not leave a dangling cursor or focus state.
    const focused = r.currentFocusedRenderable
    if (focused) focused.blur()

    const children = [...r.root.getChildren()]
    for (const child of children) {
        r.root.remove(child.id)
        child.destroyRecursively()
    }

    // Scroll the terminal to push the old footer content into the scrollback
    // area, then reset the footer height. This prevents ghost text from
    // persisting when the next component creates its footer.
    scrollTerminal(_maxFooterHeight - 1)
    _maxFooterHeight = 1
    r.footerHeight = 1
    r.requestRender()
}

export const writeScrollback = (content: StyledText): void => {
    if (_renderer && !_renderer.isDestroyed) {
        try {
            _renderer.writeToScrollback((ctx) => {
                const visibleLen = content.chunks.reduce((s, c) => s + c.text.length, 0)
                const height = Math.max(1, Math.ceil(visibleLen / ctx.width))
                const text = new TextRenderable(ctx.renderContext, {
                    height,
                    width: ctx.width,
                    wrapMode: 'char',
                    content,
                })
                return { root: text, trailingNewline: true }
            })
            return
        } catch {
            // Renderer may have left split-footer mode; fall through.
        }
    }
    process.stdout.write(content.chunks.map((c) => c.text).join('') + '\n')
}

/** Write a plain string (with optional ANSI codes) to scrollback. */
export const writeString = (content: string): void => {
    if (_renderer && !_renderer.isDestroyed) {
        try {
            const prevMode = _renderer.externalOutputMode
            _renderer.externalOutputMode = 'passthrough'
            process.stdout.write(content + '\n')
            _renderer.externalOutputMode = prevMode
            return
        } catch {
            // fall through
        }
    }
    process.stdout.write(content + '\n')
}

export const destroyRenderer = (): void => {
    if (_hintTimer !== null) {
        clearTimeout(_hintTimer)
        _hintTimer = null
    }
    _hintLine = null
    _extraFooterHeight = 0

    if (_renderer && !_renderer.isDestroyed) {
        _renderer.destroy()
    }
    _renderer = null
    _initPromise = null
}
