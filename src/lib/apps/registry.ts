import type { PackageProvider } from '#lib/types'

import { scoopProvider } from './providers/scoop'
import { wingetProvider } from './providers/winget'

const providers: PackageProvider[] = [scoopProvider, wingetProvider]

export const getAvailableProviders = (): PackageProvider[] =>
    providers.filter((p) => p.platforms.includes(process.platform) && p.isAvailable())
