import { destr } from 'destr'
import { ofetch } from 'ofetch'

import type { ConfigStore, SyncBackend, SyncData } from '#lib/types'

import { configStore } from '../../../store'
import { assertSafeProviderId, isSafeProviderId } from '../../apps/provider-id'
import { resolveGistId } from '../../github'
import { getConfigFileName, getHostHash } from '../../hosthash'

const GITHUB_API = 'https://api.github.com'

const authedFetch = (token: string) =>
    ofetch.create({
        baseURL: GITHUB_API,
        headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `token ${token}`,
        },
    })

interface GistResponse {
    id: string
    html_url: string
    files: Record<string, { raw_url: string; content?: string }>
}

export const parseGistAppListFileName = (filename: string): string | null => {
    const match = filename.match(/^apps_([a-z0-9_-]+)\.json$/)
    if (!match) return null

    const providerId = match[1]!
    return isSafeProviderId(providerId) ? providerId : null
}

export const createGistBackend = (token: string): SyncBackend => {
    const api = authedFetch(token)

    const fetchFile = async (file: { content?: string; raw_url: string }) =>
        file.content ??
        ofetch<string>(file.raw_url, {
            parseResponse: (txt) => txt,
            headers: { Authorization: `token ${token}` },
        })

    return {
        label: 'gist',

        async push(data: SyncData): Promise<string> {
            const cfg = await configStore.read()
            const fileName = getConfigFileName()

            const files: Record<string, { content: string } | null> = {
                [fileName]: { content: JSON.stringify(data.config, null, 2) },
            }

            // When updating an existing gist, delete the old filename to avoid duplicates.
            // Note: the value must be `null` (not `{ content: null }`) for GitHub to delete the file.
            if (cfg.gistId) {
                const existingGist = await api<GistResponse>(`/gists/${cfg.gistId}`)
                const oldFileName = `bekk_config_${getHostHash()}.json`
                if (oldFileName in existingGist.files) {
                    files[oldFileName] = null
                }
            }

            for (const [providerId, apps] of Object.entries(data.appLists)) {
                if (apps !== null) {
                    files[`apps_${assertSafeProviderId(providerId)}.json`] = {
                        content: JSON.stringify(apps, null, 2),
                    }
                }
            }

            const gist = await api<GistResponse>(cfg.gistId ? `/gists/${cfg.gistId}` : '/gists', {
                method: cfg.gistId ? 'PATCH' : 'POST',
                body: {
                    description: 'Bekk Config Data',
                    public: false,
                    files,
                },
            })

            await configStore.patch({ gistId: gist.id })
            return gist.html_url
        },

        async pull(identifier?: string): Promise<SyncData> {
            const cfg = await configStore.read()
            const rawId = identifier ?? cfg.gistId
            if (!rawId)
                throw new Error(
                    'No Gist ID configured. Provide one with --from or run `bekk push` first.',
                )

            const gistId = resolveGistId(rawId)
            if (!gistId) throw new Error(`Invalid Gist ID or URL: ${rawId}`)

            const gist = await api<{
                files: Record<string, { content?: string; raw_url: string }>
            }>(`/gists/${gistId}`)

            const preferredName = getConfigFileName()
            const configEntry =
                Object.entries(gist.files).find(([name]) => name === preferredName) ??
                Object.entries(gist.files).find(([name]) => name.startsWith('_bekk_config_')) ??
                Object.entries(gist.files).find(([name]) => name.startsWith('bekk_config_'))

            if (!configEntry) throw new Error(`No config file found in Gist: ${gistId}`)
            const [, configFile] = configEntry

            const configContent = await fetchFile(configFile)
            const parsedConfig = destr<Record<string, unknown>>(configContent)
            const localConfig = await configStore.read()

            const get = <K extends keyof ConfigStore>(
                key: K,
                check: (v: unknown) => boolean,
            ): ConfigStore[K] => {
                const remoteValue = parsedConfig[key]
                return check(remoteValue) ? (remoteValue as ConfigStore[K]) : localConfig[key]
            }

            // Read app lists from Gist if present
            const appLists: Record<string, import('#lib/types').App[] | null> = {}

            for (const [filename, file] of Object.entries(gist.files)) {
                const providerId = parseGistAppListFileName(filename)
                if (providerId && file) {
                    appLists[providerId] = destr(await fetchFile(file)) ?? null
                }
            }

            return {
                config: {
                    sourcePaths: get('sourcePaths', Array.isArray),
                    repoPath: get('repoPath', (v) => typeof v === 'string'),
                    gistId: get('gistId', (v) => typeof v === 'string'),
                    gistEnabled: get('gistEnabled', (v) => typeof v === 'boolean'),
                    s3DestinationsJson: get('s3DestinationsJson', (v) => typeof v === 'string'),
                    scheduleConfigJson: get('scheduleConfigJson', (v) => typeof v === 'string'),
                    compression: get('compression', (v) => typeof v === 'number'),
                    extraVerify: get('extraVerify', (v) => typeof v === 'boolean'),
                    packSizeMib: get('packSizeMib', (v) => typeof v === 'number'),
                    chunkSizeMib: get('chunkSizeMib', (v) => typeof v === 'number'),
                    snapshotLimit: get('snapshotLimit', (v) => typeof v === 'number'),
                    savedPassword: get('savedPassword', (v) => typeof v === 'string'),
                    providerConfigsJson: get('providerConfigsJson', (v) => typeof v === 'string'),
                },
                appLists,
            }
        },
    }
}
