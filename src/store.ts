import type { UpdateNotifierCacheAdapter } from '@crustjs/plugins'
import { configDir, createStore, field, stateDir } from '@crustjs/store'
import { z } from 'zod'

import {
    DEFAULT_CHUNK_SIZE_MIB,
    DEFAULT_COMPRESSION,
    DEFAULT_EXTRA_VERIFY,
    DEFAULT_PACK_SIZE_MIB,
    DEFAULT_SNAPSHOT_LIMIT,
} from '#lib/defaults'

// ─── Config Store ────────────────────────────────────────────────────────────

export const configStore = createStore({
    dirPath: configDir('bekk'),
    fields: {
        sourcePaths: field(z.array(z.string()), {
            type: 'string',
            array: true,
            default: [] as string[],
        }),
        repoPath: field(z.string(), {
            type: 'string',
            default: '',
        }),
        gistId: field(z.string(), {
            type: 'string',
            default: '',
        }),
        scheduleConfigJson: field(z.string(), {
            type: 'string',
            default: '[]',
        }),
        gistEnabled: field(z.boolean(), {
            type: 'boolean',
            default: false,
        }),
        s3DestinationsJson: field(z.string(), {
            type: 'string',
            default: '[]',
        }),
        providerConfigsJson: field(z.string(), {
            type: 'string',
            default: '{}',
        }),
        compression: field(z.number().int().min(-7).max(22), {
            type: 'number',
            default: DEFAULT_COMPRESSION,
        }),
        extraVerify: field(z.boolean(), {
            type: 'boolean',
            default: DEFAULT_EXTRA_VERIFY,
        }),
        packSizeMib: field(z.number().int().positive(), {
            type: 'number',
            default: DEFAULT_PACK_SIZE_MIB,
        }),
        chunkSizeMib: field(z.number().int().positive(), {
            type: 'number',
            default: DEFAULT_CHUNK_SIZE_MIB,
        }),
        snapshotLimit: field(z.number().int().positive().min(1), {
            type: 'number',
            default: DEFAULT_SNAPSHOT_LIMIT,
        }),
        savedPassword: field(z.string(), {
            type: 'string',
            default: '',
        }),
    },
})

export type ConfigStore = Awaited<ReturnType<typeof configStore.read>>

// ─── Update Notifier Store ────────────────────────────────────────────────────

const updateNotifierInternalStore = createStore({
    dirPath: stateDir('bekk'),
    name: 'update-notifier',
    fields: {
        lastCheckedAt: { type: 'number', default: 0 },
        latestVersion: { type: 'string' },
        lastNotifiedVersion: { type: 'string' },
    },
})

export const updateNotifierCacheAdapter: UpdateNotifierCacheAdapter = {
    read: () => updateNotifierInternalStore.read(),
    write: (state) =>
        updateNotifierInternalStore.write({
            lastCheckedAt: state.lastCheckedAt,
            latestVersion: state.latestVersion,
            lastNotifiedVersion: state.lastNotifiedVersion,
        }),
}
