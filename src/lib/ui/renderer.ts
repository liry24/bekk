// ─── renderer.ts ─── OpenTUI singleton + footer helpers ─────────────────────

import { createCliRenderer, TextRenderable, type CliRenderer, type KeyEvent } from '@opentui/core'

let _renderer: CliRenderer | null = null
let _initPromise: Promise<CliRenderer> | null = null
let _hintLine: TextRenderable | null = null
let _extraFooterHeight = 0
let _hintTimer: ReturnType<typeof setTimeout> | null = null

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

        // Global fallback: double-Ctrl+C to exit when no prompt handler consumes it.
        // First press shows a removable hint line in the footer; second press within
        // 3 s exits with code 130. The hint disappears when the 3 s window expires.
        // Uses keyInput.on("keypress") so prompt handlers installed via
        // prependInputHandler (which consume \x03 before the key parser) still take
        // priority and this handler only fires when no prompt is active.
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
    // Cancel pending hint timer to avoid a dangling hideHint call after clear.
    if (_hintTimer !== null) {
        clearTimeout(_hintTimer)
        _hintTimer = null
    }
    // Null out _hintLine before destroyRecursively so any stale timer callback
    // that somehow fires will safely short-circuit in hideHint.
    _hintLine = null
    _extraFooterHeight = 0

    const children = [...r.root.getChildren()]
    for (const child of children) {
        r.root.remove(child.id)
        child.destroyRecursively()
    }
    r.footerHeight = 1
    r.requestRender()
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
