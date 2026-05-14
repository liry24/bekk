import { EventEmitter } from 'node:events'

export interface MockRenderable {
    id: string
    destroyRecursively: () => void
    blur?: () => void
}

export class MockRenderer extends EventEmitter {
    width = 80
    height = 24
    terminalHeight = 24
    footerHeight = 1
    isDestroyed = false
    screenMode = 'split-footer'
    externalOutputMode = 'capture-stdout'
    currentFocusedRenderable: MockRenderable | null = null

    private _children: MockRenderable[] = []
    private _frameCallback: ((dt: number) => Promise<void>) | null = null
    private _inputHandlers: ((seq: string) => boolean)[] = []
    private _scrollbackWrites: unknown[] = []

    get root() {
        const self = this
        return {
            add(child: MockRenderable) {
                self._children.push(child)
            },
            remove(id: string) {
                const idx = self._children.findIndex((c) => c.id === id)
                if (idx >= 0) self._children.splice(idx, 1)
            },
            getChildren() {
                return [...self._children]
            },
            flexDirection: 'column' as const,
        }
    }

    getChildren() {
        return [...this._children]
    }

    requestRender() {}

    requestLive() {}

    dropLive() {}

    setFrameCallback(cb: (dt: number) => Promise<void>) {
        this._frameCallback = cb
    }

    removeFrameCallback(_cb: (dt: number) => Promise<void>) {
        this._frameCallback = null
    }

    prependInputHandler(handler: (seq: string) => boolean) {
        this._inputHandlers.unshift(handler)
    }

    addInputHandler(handler: (seq: string) => boolean) {
        this._inputHandlers.push(handler)
    }

    removeInputHandler(handler: (seq: string) => boolean) {
        const idx = this._inputHandlers.indexOf(handler)
        if (idx >= 0) this._inputHandlers.splice(idx, 1)
    }

    simulateInput(seq: string): boolean {
        for (const handler of this._inputHandlers) {
            if (handler(seq)) return true
        }
        return false
    }

    simulateFrame(dt = 16) {
        if (this._frameCallback) {
            void this._frameCallback(dt)
        }
    }

    writeToScrollback(writer: (ctx: unknown) => unknown) {
        this._scrollbackWrites.push(writer)
    }

    getScrollbackWrites() {
        return [...this._scrollbackWrites]
    }

    destroy() {
        this.isDestroyed = true
        this._children = []
        this._frameCallback = null
        this._inputHandlers = []
        this.emit('destroy')
    }

    reset() {
        this.isDestroyed = false
        this._children = []
        this._frameCallback = null
        this._inputHandlers = []
        this._scrollbackWrites = []
        this.footerHeight = 1
    }
}

export const createMockRenderer = (): MockRenderer => {
    return new MockRenderer()
}
