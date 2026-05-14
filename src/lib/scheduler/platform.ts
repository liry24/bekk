import { linuxScheduler } from './linux'
import { macosScheduler } from './macos'
import type { Scheduler } from './types'
import { windowsScheduler } from './windows'

export const getScheduler = (): Scheduler => {
    switch (process.platform) {
        case 'win32':
            return windowsScheduler
        case 'darwin':
            return macosScheduler
        case 'linux':
            return linuxScheduler
        default:
            throw new Error(`Unsupported platform: ${process.platform}`)
    }
}
