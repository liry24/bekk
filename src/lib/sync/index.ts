import { destr } from 'destr'

import { authStore, configStore } from '../../store'
import { getS3SecretAccessKey } from '../secrets'
import { GistBackend } from './gist'
import { S3Backend } from './s3'
import type { S3Destination, SyncBackend } from './types'

export { GistBackend } from './gist'
export { S3Backend } from './s3'
export type { S3Destination, SyncBackend, SyncData } from './types'

/**
 * Parse S3 destinations from the config store's JSON field.
 * Returns an empty array on any parse error.
 */
export const parseS3Destinations = (json: string) => {
    const parsed = destr<S3Destination[]>(json)
    return Array.isArray(parsed) ? parsed : []
}

/**
 * Returns the list of enabled SyncBackend instances based on current config.
 * Loads credentials from Bun.secrets as needed.
 */
export const getEnabledBackends = async () => {
    const cfg = await configStore.read()
    const backends: SyncBackend[] = []

    if (cfg.gistEnabled) {
        const { token } = await authStore.read()
        if (token) backends.push(new GistBackend(token))
    }

    const destinations = parseS3Destinations(cfg.s3DestinationsJson)
    for (const dest of destinations) {
        const secretKey = await getS3SecretAccessKey(dest.name)
        if (secretKey) backends.push(new S3Backend(dest, secretKey))
    }

    return backends
}
