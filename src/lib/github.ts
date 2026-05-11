import { ofetch } from 'ofetch'
import open from 'open'
import { renderANSI } from 'uqr'

import { blue, bold, cyan, dim, orderedList, writeString } from '#lib/ui'

const GITHUB_API = 'https://api.github.com'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

// GitHub OAuth App Client ID (non-secret, safe to embed in binary)
export const GITHUB_CLIENT_ID = 'Ov23ctwZ6oK5OrIX9Gch'

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
    writeString('')
    writeString(qr)

    // Step 2: Prompt user
    writeString('')
    writeString(
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
    writeString('')

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
