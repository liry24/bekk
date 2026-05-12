export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'interval'

export interface ScheduleConfig {
    type: ScheduleType
    time?: string
    day?: string
    interval?: number
}

export interface Scheduler {
    install(label: string, program: string, args: string[], config: ScheduleConfig): Promise<void>
    uninstall(label: string): Promise<void>
    status(label: string): Promise<{ installed: boolean }>
}
