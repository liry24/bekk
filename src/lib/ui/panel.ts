// ─── panel.ts ─── OpenTUI Box panel drawing ────────────────────────────────

import { BoxRenderable, TextRenderable } from '@opentui/core'

import { ansiToStyledText } from './layout'
import { getRenderer } from './renderer'

export interface PanelOptions {
    title?: string
}

export const drawPanel = async (lines: string[], options?: PanelOptions): Promise<void> => {
    const r = await getRenderer()
    if (r.isDestroyed) return

    r.writeToScrollback((ctx) => {
        const box = new BoxRenderable(ctx.renderContext, {
            borderStyle: 'rounded',
            border: true,
            padding: 1,
            flexDirection: 'column',
            title: options?.title,
            titleAlignment: 'left',
        })

        for (const line of lines) {
            box.add(
                new TextRenderable(ctx.renderContext, {
                    content: ansiToStyledText(line),
                    height: 1,
                }),
            )
        }

        // height: 1 (top border) + 1 (top padding) + N lines + 1 (bottom padding) + 1 (bottom border)
        const boxHeight = lines.length + 4

        return { root: box, width: ctx.width, height: boxHeight, trailingNewline: true }
    })
}
