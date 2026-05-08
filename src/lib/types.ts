import type { ConfigStore as _ConfigStore } from '../store'

export type { ConfigStore } from '../store'

export interface App<T = Record<string, unknown>> {
    name: string
    version: string
    source?: string
    meta: T
}

export interface PackageProvider {
    readonly id: string
    readonly name: string
    readonly platforms: NodeJS.Platform[]
    isAvailable: () => boolean
    list: () => Promise<App[] | null>
}

export interface S3Destination {
    name: string
    bucket: string
    region: string
    endpoint: string
    accessKeyId: string
}

export interface SyncData {
    config: _ConfigStore
    appLists: Record<string, App[] | null>
}

export interface SyncBackend {
    readonly label: string
    push: (data: SyncData) => Promise<string>
    pull: (identifier?: string) => Promise<SyncData>
}
