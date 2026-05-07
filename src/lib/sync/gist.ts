import { destr } from 'destr'
import { ofetch } from 'ofetch'

import { configStore } from '../../store'
import { resolveGistId } from '../github'
import { getConfigFileName } from '../hosthash'
import type { SyncBackend, SyncData } from './types'

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

export class GistBackend implements SyncBackend {
    readonly label = 'gist'

    constructor(private readonly token: string) {}

    async push(data: SyncData): Promise<string> {
        const cfg = await configStore.read()
        const fileName = await getConfigFileName()
        const api = authedFetch(this.token)

        const files: Record<string, { content: string }> = {
            [fileName]: { content: JSON.stringify(data.config, null, 2) },
        }

        if (data.appLists.scoop !== null) {
            files['scoop.json'] = { content: JSON.stringify(data.appLists.scoop, null, 2) }
        }
        files['winget.json'] = { content: JSON.stringify(data.appLists.winget, null, 2) }

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
    }

    async pull(identifier?: string): Promise<SyncData> {
        const cfg = await configStore.read()
        const rawId = identifier ?? cfg.gistId
        if (!rawId)
            throw new Error(
                'No Gist ID configured. Provide one with --from or run `bekk push` first.',
            )

        const gistId = resolveGistId(rawId)
        if (!gistId) throw new Error(`Invalid Gist ID or URL: ${rawId}`)

        const api = authedFetch(this.token)
        const gist = await api<{ files: Record<string, { content?: string; raw_url: string }> }>(
            `/gists/${gistId}`,
        )

        const preferredName = await getConfigFileName()
        const configEntry =
            Object.entries(gist.files).find(([name]) => name === preferredName) ??
            Object.entries(gist.files).find(([name]) => name.startsWith('bekk_config_'))

        if (!configEntry) throw new Error(`No config file found in Gist: ${gistId}`)
        const [, configFile] = configEntry

        const configContent =
            configFile.content ??
            (await ofetch<string>(configFile.raw_url, {
                parseResponse: (txt) => txt,
                headers: { Authorization: `token ${this.token}` },
            }))

        const parsedConfig = destr<Record<string, unknown>>(configContent)

        // Read app lists from Gist if present
        let scoop: import('./types').SyncData['appLists']['scoop'] = null
        let winget: import('./types').SyncData['appLists']['winget'] = []

        const scoopFile = gist.files['scoop.json']
        if (scoopFile) {
            const content =
                scoopFile.content ??
                (await ofetch<string>(scoopFile.raw_url, {
                    parseResponse: (txt) => txt,
                    headers: { Authorization: `token ${this.token}` },
                }))
            scoop = destr(content) ?? null
        }

        const wingetFile = gist.files['winget.json']
        if (wingetFile) {
            const content =
                wingetFile.content ??
                (await ofetch<string>(wingetFile.raw_url, {
                    parseResponse: (txt) => txt,
                    headers: { Authorization: `token ${this.token}` },
                }))
            winget = destr(content) ?? []
        }

        return {
            config: {
                sourcePaths: Array.isArray(parsedConfig['sourcePaths'])
                    ? (parsedConfig['sourcePaths'] as string[])
                    : [],
                repoPath:
                    typeof parsedConfig['repoPath'] === 'string' ? parsedConfig['repoPath'] : '',
                gistId:
                    typeof parsedConfig['gistId'] === 'string' ? parsedConfig['gistId'] : gistId,
                gistEnabled:
                    typeof parsedConfig['gistEnabled'] === 'boolean'
                        ? parsedConfig['gistEnabled']
                        : false,
                s3DestinationsJson:
                    typeof parsedConfig['s3DestinationsJson'] === 'string'
                        ? parsedConfig['s3DestinationsJson']
                        : '[]',
                wingetIncludeSources: Array.isArray(parsedConfig['wingetIncludeSources'])
                    ? (parsedConfig['wingetIncludeSources'] as string[])
                    : ['winget', 'msstore'],
                cronSchedule:
                    typeof parsedConfig['cronSchedule'] === 'string'
                        ? parsedConfig['cronSchedule']
                        : '',
                compression:
                    typeof parsedConfig['compression'] === 'number'
                        ? parsedConfig['compression']
                        : 1,
                extraVerify:
                    typeof parsedConfig['extraVerify'] === 'boolean'
                        ? parsedConfig['extraVerify']
                        : true,
                packSizeMib:
                    typeof parsedConfig['packSizeMib'] === 'number'
                        ? parsedConfig['packSizeMib']
                        : 32,
                chunkSizeMib:
                    typeof parsedConfig['chunkSizeMib'] === 'number'
                        ? parsedConfig['chunkSizeMib']
                        : 1,
                savedPassword:
                    typeof parsedConfig['savedPassword'] === 'string'
                        ? parsedConfig['savedPassword']
                        : '',
            },
            appLists: { scoop, winget },
        }
    }
}
