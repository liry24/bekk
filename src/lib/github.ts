import { blue, bold, cyan, dim, orderedList } from '@crustjs/style'
import { destr } from 'destr'
import { ofetch } from 'ofetch'
import open from 'open'
import { join } from 'pathe'
import { renderANSI } from 'uqr'

import { authStore, configStore } from '../store'
import { getConfigFileName } from './hosthash'

const GITHUB_API = 'https://api.github.com'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

// GitHub OAuth App Client ID (non-secret, safe to embed in binary)
export const GITHUB_CLIENT_ID = 'Ov23ctwZ6oK5OrIX9Gch'

// Base GitHub REST API client (no auth)
const ghFetch = ofetch.create({
    baseURL: GITHUB_API,
    headers: { Accept: 'application/vnd.github.v3+json' },
})

// Authenticated GitHub REST API client
const authedGhFetch = (token: string) =>
    ofetch.create({
        baseURL: GITHUB_API,
        headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `token ${token}`,
        },
    })

export const resolveGistId = (input: string) => {
    const urlMatch = input.match(/gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]+)/)
    if (urlMatch) return urlMatch[1]!
    if (/^[a-f0-9]{20,}$/.test(input.trim())) return input.trim()
    return null
}

export const ensureToken = async () => {
    const { token } = await authStore.read()
    if (!token) throw new Error('Not authenticated. Please run `bekk gist login` first.')
    return token
}

export const getAuthenticatedUser = async (token: string): Promise<string | null> => {
    try {
        const { login } = await authedGhFetch(token)<{ login: string }>('/user')
        return login
    } catch {
        return null
    }
}

export const runDeviceFlow = async (clientId: string) => {
    // Step 1: Request device code
    // ofetch auto-serializes body to JSON and sets Content-Type + Accept
    const codeData = await ofetch<{
        device_code: string
        user_code: string
        verification_uri: string
        interval: number
        error?: string
        error_description?: string
    }>(DEVICE_CODE_URL, {
        method: 'POST',
        body: { client_id: clientId, scope: 'gist' },
    })
    if (codeData.error) throw new Error(`${codeData.error}: ${codeData.error_description}`)

    const qr = renderANSI(codeData.verification_uri, {})
    console.log()
    console.log(qr)

    // Step 2: Prompt user
    console.log()
    console.log(
        orderedList([
            `Open in your browser: ${cyan(codeData.verification_uri)}`,
            (() => {
                let msg = `Enter the code: ${bold(blue(codeData.user_code))}`
                try {
                    Bun.spawnSync(['clip'], { stdin: Buffer.from(codeData.user_code) })
                    msg += dim(' (clipboarded)')
                } catch {
                    // ignore clipboard failure
                }
                return msg
            })(),
        ]),
    )
    console.log()

    await open(codeData.verification_uri).catch(() => {}) // ignore open failures

    // Step 3: Poll for token
    // Token endpoint always returns 200 (pending/error encoded in body), so ofetch won't throw
    const interval = codeData.interval ?? 5
    while (true) {
        await Bun.sleep(interval * 1000)
        try {
            const tokenData = await ofetch<{ access_token?: string; error?: string }>(
                ACCESS_TOKEN_URL,
                {
                    method: 'POST',
                    body: {
                        client_id: clientId,
                        device_code: codeData.device_code,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    },
                },
            )
            if (tokenData.access_token) return tokenData.access_token
            if (
                tokenData.error &&
                tokenData.error !== 'authorization_pending' &&
                tokenData.error !== 'slow_down'
            )
                throw new Error(`Auth error: ${tokenData.error}`)
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('Auth error')) throw err
            // network error: retry silently
        }
    }
}

interface GistResponse {
    id: string
    html_url: string
    files: Record<string, { raw_url: string }>
}

export const pushGist = async (token: string) => {
    const cfg = await configStore.read()
    const fileName = await getConfigFileName()
    const api = authedGhFetch(token)

    const files: Record<string, { content: string }> = {
        [fileName]: { content: JSON.stringify(cfg, null, 2) },
    }

    // Include app lists from destination if they exist
    if (cfg.destinationRoot) {
        for (const name of ['scoop.json', 'winget.json'] as const) {
            const f = Bun.file(join(cfg.destinationRoot, name))
            if (await f.exists()) {
                files[name] = { content: await f.text() }
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
}

export const pullGist = async (gistIdOrUrl: string, token?: string) => {
    const gistId = resolveGistId(gistIdOrUrl)
    if (!gistId) throw new Error(`Invalid Gist ID or URL: ${gistIdOrUrl}`)

    const api = token ? authedGhFetch(token) : ghFetch

    const gist = await api<{ files: Record<string, { content?: string; raw_url: string }> }>(
        `/gists/${gistId}`,
    )

    const jsonFiles = Object.entries(gist.files).filter(([name]) => name.endsWith('.json'))
    if (jsonFiles.length === 0) throw new Error(`No JSON file found in Gist: ${gistId}`)

    const preferredName = await getConfigFileName()
    const [selectedName, selectedFile] =
        jsonFiles.find(([name]) => name === preferredName) ?? jsonFiles[0]!

    // Fetch raw content if not embedded (large files are truncated by GitHub)
    const content =
        selectedFile.content ??
        (await ofetch<string>(selectedFile.raw_url, {
            parseResponse: (txt) => txt,
            headers: token ? { Authorization: `token ${token}` } : undefined,
            responseType: 'json',
        }))

    const parsed = destr<Record<string, unknown>>(content)

    await configStore.write({
        sourcePaths: Array.isArray(parsed.sourcePaths) ? (parsed.sourcePaths as string[]) : [],
        destinationRoot: typeof parsed.destinationRoot === 'string' ? parsed.destinationRoot : '',
        gistId: typeof parsed.gistId === 'string' ? parsed.gistId : gistId,
        robocopyMirror: typeof parsed.robocopyMirror === 'boolean' ? parsed.robocopyMirror : true,
        robocopyRetryCount:
            typeof parsed.robocopyRetryCount === 'number' ? parsed.robocopyRetryCount : 3,
        robocopyRetryWait:
            typeof parsed.robocopyRetryWait === 'number' ? parsed.robocopyRetryWait : 5,
        robocopyExcludeJunctions:
            typeof parsed.robocopyExcludeJunctions === 'boolean'
                ? parsed.robocopyExcludeJunctions
                : true,
        wingetIncludeSources: Array.isArray(parsed.wingetIncludeSources)
            ? (parsed.wingetIncludeSources as string[])
            : ['winget', 'msstore'],
    })

    console.log(`Config loaded from ${selectedName}`)
}
