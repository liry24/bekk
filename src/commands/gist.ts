import consola from 'consola'

import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '#lib/github'
import { bold, cyan, dim, green, yellow } from '#lib/ui'
import { confirm } from '#lib/ui'

import { app } from '../app'
import { authStore, configStore } from '../store'

// ─── gist login ───────────────────────────────────────────────────────────────

const loginCmd = app
    .sub('gist')
    .sub('login')
    .meta({ description: 'Authenticate via GitHub Device Flow' })
    .run(async () => {
        const { token } = await authStore.read()

        if (token) {
            const username = await getAuthenticatedUser(token)
            if (username) {
                consola.ready(green(`Already authenticated as ${bold(cyan(username))}.`))
                consola.info(dim('Run `bekk gist logout` to sign out.'))
                return
            }
            consola.warn(yellow('Stored token is invalid. Re-authenticating...'))
        }

        consola.info('Starting GitHub Device Flow authentication...')

        const newToken = await runDeviceFlow(GITHUB_CLIENT_ID)
        await authStore.patch({ token: newToken })
        await configStore.patch({ gistEnabled: true })

        const username = await getAuthenticatedUser(newToken)
        const label = username ? bold(cyan(username)) : 'unknown'
        consola.success(green(`Authentication complete. Signed in as ${label}.`))
        consola.info(dim('Gist sync is now enabled. Run `bekk push` to upload your config.'))
    })

// ─── gist logout ──────────────────────────────────────────────────────────────

const logoutCmd = app
    .sub('gist')
    .sub('logout')
    .meta({ description: 'Remove stored authentication token' })
    .run(async () => {
        const { token } = await authStore.read()

        if (!token) {
            console.log(dim('Not authenticated.'))
            return
        }

        const username = await getAuthenticatedUser(token)
        const label = username ? bold(cyan(username)) : 'unknown'

        console.log(`Currently signed in as ${label}.`)
        console.log()

        const ok = await confirm({
            message: yellow(`Sign out of ${label}?`),
            default: false,
        })
        if (!ok) {
            console.log(dim('Cancelled.'))
            return
        }

        await authStore.patch({ token: '' })
        await configStore.patch({ gistEnabled: false })
        consola.success(green('Signed out. Gist sync disabled.'))
    })

// ─── gist (container) ─────────────────────────────────────────────────────────

export const gistCmd = app
    .sub('gist')
    .meta({ description: 'Manage GitHub authentication for Gist sync' })
    .command(loginCmd)
    .command(logoutCmd)
