import type { UpdateNotifierCacheAdapter } from '@crustjs/plugins'
import { configDir, createStore, dataDir, stateDir } from '@crustjs/store'
import { fieldSync } from '@crustjs/validate/zod'
import { z } from 'zod'

// ─── Config Store ────────────────────────────────────────────────────────────

export const configStore = createStore({
    dirPath: configDir('bekk'),
    fields: {
        sourcePaths: {
            type: 'string',
            array: true,
            default: [] as string[],
            validate: fieldSync(z.array(z.string())),
        },
        repoPath: {
            type: 'string',
            default: '',
            validate: fieldSync(z.string()),
        },
        gistId: {
            type: 'string',
            default: '',
            validate: fieldSync(z.string()),
        },
        cronSchedule: {
            type: 'string',
            default: '',
            validate: fieldSync(z.string()),
        },
        gistEnabled: {
            type: 'boolean',
            default: false,
            validate: fieldSync(z.boolean()),
        },
        s3DestinationsJson: {
            type: 'string',
            default: '[]',
            validate: fieldSync(z.string()),
        },
        providerConfigsJson: {
            type: 'string',
            default: '{}',
            validate: fieldSync(z.string()),
        },
        compression: {
            type: 'number',
            default: 1,
            validate: fieldSync(z.number().int().min(-7).max(22)),
        },
        extraVerify: {
            type: 'boolean',
            default: true,
            validate: fieldSync(z.boolean()),
        },
        packSizeMib: {
            type: 'number',
            default: 32,
            validate: fieldSync(z.number().int().positive()),
        },
        chunkSizeMib: {
            type: 'number',
            default: 1,
            validate: fieldSync(z.number().int().positive()),
        },
        snapshotLimit: {
            type: 'number',
            default: 1,
            validate: fieldSync(z.number().int().positive().min(1)),
        },
        savedPassword: {
            type: 'string',
            default: '',
            validate: fieldSync(z.string()),
        },
    },
})

export type ConfigStore = Awaited<ReturnType<typeof configStore.read>>

// ─── Auth Store ───────────────────────────────────────────────────────────────

export const authStore = createStore({
    dirPath: dataDir('bekk'),
    name: 'auth',
    fields: {
        token: {
            type: 'string',
            default: '',
            validate: fieldSync(z.string()),
        },
    },
})

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
    read: async () => {
        const s = await updateNotifierInternalStore.read()
        return { ...s }
    },
    write: async (state) => {
        await updateNotifierInternalStore.write({
            lastCheckedAt: state.lastCheckedAt,
            latestVersion: state.latestVersion,
            lastNotifiedVersion: state.lastNotifiedVersion,
        })
    },
}
