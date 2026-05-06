import { bold, cyan, dim, green, yellow } from '@crustjs/style'
import { createConsola } from 'consola'

import { app } from '../app'
import { GITHUB_CLIENT_ID, getAuthenticatedUser, runDeviceFlow } from '../lib/github'
import { authStore } from '../store'

const logger = createConsola({ formatOptions: { date: false } })

export const loginCmd = app
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
            // Token exists but invalid — fall through to re-authenticate
            logger.warn(yellow('Stored token is invalid. Re-authenticating...'))
        }

        logger.info('Starting GitHub Device Flow authentication...')

        const newToken = await runDeviceFlow(GITHUB_CLIENT_ID)
        await authStore.write({ token: newToken })

        const username = await getAuthenticatedUser(newToken)
        const label = username ? bold(cyan(username)) : 'unknown'
        logger.success(green(`Authentication complete. Signed in as ${label}.`))
    })
