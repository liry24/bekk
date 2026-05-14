import { select } from '#lib/ui'

export interface MenuItem<T extends string> {
    label: string
    value: T
    hint?: string | (() => string | Promise<string>)
    handler?: () => Promise<void>
    disabled?: boolean
}

export interface MenuOptions<T extends string> {
    backValue?: T
    onBack?: () => Promise<void>
}

export const runMenu = async <T extends string>(
    message: string,
    getItems: () => Promise<MenuItem<T>[]> | MenuItem<T>[],
    options?: MenuOptions<T>,
) => {
    const backValue = options?.backValue
    let action: T | undefined

    do {
        const items = await getItems()
        const choices = await Promise.all(
            items.map(async (item) => ({
                label: item.label,
                value: item.value,
                hint:
                    typeof item.hint === 'function' ? await item.hint() : (item.hint ?? undefined),
            })),
        )

        action = await select<T>({ message, choices })

        const item = items.find((i) => i.value === action)
        if (item && item.handler && !item.disabled && action !== backValue) await item.handler()
    } while (action !== backValue)

    if (action === backValue && options?.onBack) await options.onBack()
}
