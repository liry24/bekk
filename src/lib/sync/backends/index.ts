import { destr } from 'destr'

import type { SyncBackend } from '#lib/types'

import { authStore, configStore } from '../../../store'
import { getS3SecretAccessKey } from '../../secrets'
import { createGistBackend } from './gist'
import { createS3Backend } from './s3'

export { createGistBackend } from './gist'
export { createS3Backend } from './s3'

/**
 * Parse S3 destinations from the config store's JSON field.
 * Returns an empty array on any parse error.
 */
export const parseS3Destinations = (json: string) => {
    const parsed = destr<import('#lib/types').S3Destination[]>(json)
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
        if (token) backends.push(createGistBackend(token))
    }

    const destinations = parseS3Destinations(cfg.s3DestinationsJson)
    for (const dest of destinations) {
        const secretKey = await getS3SecretAccessKey(dest.name)
        if (secretKey) backends.push(createS3Backend(dest, secretKey))
    }

    return backends
}
