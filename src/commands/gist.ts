import { confirm } from '@crustjs/prompts'
import { bold, cyan, dim, green, yellow } from '@crustjs/style'
import { createConsola } from 'consola'

import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '#lib/github'
import { cliLog } from '#lib/log'

import { app } from '../app'
import { authStore, configStore } from '../store'

const logger = createConsola({ formatOptions: { date: false } })

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
                logger.ready(green(`Already authenticated as ${bold(cyan(username))}.`))
                logger.info(dim('Run `bekk gist logout` to sign out.'))
                return
            }
            logger.warn(yellow('Stored token is invalid. Re-authenticating...'))
        }

        logger.info('Starting GitHub Device Flow authentication...')

        const newToken = await runDeviceFlow(GITHUB_CLIENT_ID)
        await authStore.patch({ token: newToken })
        await configStore.patch({ gistEnabled: true })

        const username = await getAuthenticatedUser(newToken)
        const label = username ? bold(cyan(username)) : 'unknown'
        logger.success(green(`Authentication complete. Signed in as ${label}.`))
        logger.info(dim('Gist sync is now enabled. Run `bekk push` to upload your config.'))
    })

// ─── gist logout ──────────────────────────────────────────────────────────────

const logoutCmd = app
    .sub('gist')
    .sub('logout')
    .meta({ description: 'Remove stored authentication token' })
    .run(async () => {
        const { token } = await authStore.read()

        if (!token) {
            logger.log(dim('Not authenticated.'))
            return
        }

        const username = await getAuthenticatedUser(token)
        const label = username ? bold(cyan(username)) : 'unknown'

        logger.log(`Currently signed in as ${label}.`)
        cliLog({ padding: { side: 'top' } })

        const ok = await confirm({
            message: yellow(`Sign out of ${label}?`),
            default: false,
        })
        if (!ok) {
            logger.log(dim('Cancelled.'))
            return
        }

        await authStore.patch({ token: '' })
        await configStore.patch({ gistEnabled: false })
        logger.success(green('Signed out. Gist sync disabled.'))
    })

// ─── gist (container) ─────────────────────────────────────────────────────────

export const gistCmd = app
    .sub('gist')
    .meta({ description: 'Manage GitHub authentication for Gist sync' })
    .command(loginCmd)
    .command(logoutCmd)
