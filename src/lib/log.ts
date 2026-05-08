import { createConsola, type LogType } from 'consola'

type LogMessage = string | string[]

type LogObject = {
    message: LogMessage
    type?: LogType
}

type Log = LogMessage | LogObject

interface LogOptions {
    messages?: Log | Log[] | boolean | null | undefined
    type?: LogType
    timestamp?: boolean
    padding?: {
        side: 'top' | 'bottom' | 'both'
        lines?: number
    }
}

export const cliLog = (
    options: LogOptions = {
        messages: '',
        type: 'log',
        timestamp: false,
    },
) => {
    const { messages, type = 'log', timestamp = false, padding } = options

    const logger = createConsola({ formatOptions: { date: timestamp } })
    const logFn = logger[type]

    const pad = padding?.lines || 1
    if (padding?.side === 'top' || padding?.side === 'both') console.log('\n'.repeat(pad))

    if (typeof messages === 'boolean' || messages === null || messages === undefined) return
    else if (Array.isArray(messages)) messages.map((msg) => logFn(msg))
    else if (typeof messages === 'string') logFn(messages)
    else logger[messages.type || 'log'](messages.message)

    if (padding?.side === 'bottom' || padding?.side === 'both') console.log('\n'.repeat(pad))
}
