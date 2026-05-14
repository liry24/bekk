import type { ScheduleConfig, Scheduler } from '#lib/scheduler'

export interface SchedulerCall {
    method: 'install' | 'uninstall' | 'status'
    label: string
    program?: string
    args?: string[]
    config?: ScheduleConfig
}

export class MockScheduler implements Scheduler {
    readonly calls: SchedulerCall[] = []
    private _installed = new Set<string>()

    async install(
        label: string,
        program: string,
        args: string[],
        config: ScheduleConfig,
    ): Promise<void> {
        this.calls.push({ method: 'install', label, program, args, config })
        this._installed.add(label)
    }

    async uninstall(label: string): Promise<void> {
        this.calls.push({ method: 'uninstall', label })
        this._installed.delete(label)
    }

    async status(label: string): Promise<{ installed: boolean }> {
        this.calls.push({ method: 'status', label })
        return { installed: this._installed.has(label) }
    }

    /** Seed a label as already installed (for testing rm / status paths). */
    seedInstalled(label: string): void {
        this._installed.add(label)
    }

    reset(): void {
        this.calls.length = 0
        this._installed.clear()
    }
}

export const createMockScheduler = (): MockScheduler => new MockScheduler()
