import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '#lib/github'
import { deleteGitHubToken, getGitHubToken, setGitHubToken } from '#lib/secrets'
import { bold, cyan, dim, green, yellow, confirm, writeString } from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

// ─── gist login ───────────────────────────────────────────────────────────────

const loginCmd = app
    .sub('gist')
    .sub('login')
    .meta({ description: 'Authenticate via GitHub Device Flow' })
    .run(async () => {
        const token = await getGitHubToken()

        if (token) {
            const username = await getAuthenticatedUser(token)
            if (username) {
                writeString(green(`Already authenticated as ${bold(cyan(username))}.`))
                writeString(dim('Run `bekk gist logout` to sign out.'))
                return
            }
            writeString(yellow('Stored token is invalid. Re-authenticating...'))
        }

        writeString('Starting GitHub Device Flow authentication...')

        const newToken = await runDeviceFlow(GITHUB_CLIENT_ID)
        await setGitHubToken(newToken)
        await configStore.patch({ gistEnabled: true })

        const username = await getAuthenticatedUser(newToken)
        const label = username ? bold(cyan(username)) : 'unknown'
        writeString(green(`Authentication complete. Signed in as ${label}.`))
        writeString(dim('Gist sync is now enabled. Run `bekk push` to upload your config.'))
    })

// ─── gist logout ──────────────────────────────────────────────────────────────

const logoutCmd = app
    .sub('gist')
    .sub('logout')
    .meta({ description: 'Remove stored authentication token' })
    .run(async () => {
        const token = await getGitHubToken()

        if (!token) {
            writeString(dim('Not authenticated.'))
            return
        }

        const username = await getAuthenticatedUser(token)
        const label = username ? bold(cyan(username)) : 'unknown'

        writeString(`Currently signed in as ${label}.`)
        writeString('')

        const ok = await confirm({
            message: yellow(`Sign out of ${label}?`),
            default: false,
        })
        if (!ok) {
            writeString(dim('Cancelled.'))
            return
        }

        await deleteGitHubToken()
        await configStore.patch({ gistEnabled: false })
        writeString(green('Signed out. Gist sync disabled.'))
    })

// ─── gist (container) ─────────────────────────────────────────────────────────

export const gistCmd = app
    .sub('gist')
    .meta({ description: 'Manage GitHub authentication for Gist sync' })
    .command(loginCmd)
    .command(logoutCmd)
