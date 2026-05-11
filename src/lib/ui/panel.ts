// ─── panel.ts ─── OpenTUI Box panel drawing ────────────────────────────────

import { BoxRenderable, TextRenderable, stringToStyledText } from '@opentui/core'

import { getRenderer } from './renderer'

export interface PanelOptions {
    title?: string
}

export const drawPanel = async (lines: string[], options?: PanelOptions): Promise<void> => {
    const r = await getRenderer()
    if (r.isDestroyed) return

    r.writeToScrollback(() => {
        const box = new BoxRenderable(r, {
            borderStyle: 'rounded',
            border: true,
            padding: 1,
            flexDirection: 'column',
            title: options?.title,
            titleAlignment: 'left',
        })

        for (const line of lines) {
            box.add(
                new TextRenderable(r, {
                    content: stringToStyledText(line),
                }),
            )
        }

        return { root: box, trailingNewline: true }
    })
}
