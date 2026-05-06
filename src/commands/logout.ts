import { confirm } from '@crustjs/prompts'
import { bold, cyan, dim, green, yellow } from '@crustjs/style'
import { createConsola } from 'consola'

import { app } from '../app'
import { getAuthenticatedUser } from '../lib/github'
import { authStore } from '../store'

const logger = createConsola({ formatOptions: { date: false } })

export const logoutCmd = app
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
        console.log()

        const ok = await confirm({
            message: yellow(`Sign out of ${label}?`),
            default: false,
        })
        if (!ok) {
            logger.log(dim('Cancelled.'))
            return
        }

        await authStore.write({ token: '' })
        logger.success(green('Signed out.'))
    })
