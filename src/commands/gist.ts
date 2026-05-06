import { spinner } from '@crustjs/progress'
import { input } from '@crustjs/prompts'
import { bold, dim, green, link } from '@crustjs/style'
import { arg, commandValidator } from '@crustjs/validate/zod'
import { createConsola } from 'consola'
import { z } from 'zod'

import { app } from '../app'
import { ensureToken, pullGist, pushGist, resolveGistId } from '../lib/github'

const logger = createConsola({ formatOptions: { date: false } })

const pushCmd = app
    .sub('gist')
    .sub('push')
    .meta({ description: 'Upload config to GitHub Gist' })
    .run(async () => {
        const token = await ensureToken()

        let gistUrl!: string
        await spinner({
            message: 'Uploading to Gist...',
            task: async ({ updateMessage }) => {
                gistUrl = await pushGist(token)
                updateMessage('Upload complete')
            },
        })

        logger.success(green(bold('Uploaded to Gist.')))
        logger.log('  ' + link(gistUrl, gistUrl))
    })

const pullCmd = app
    .sub('gist')
    .sub('pull')
    .meta({
        description: 'Download config from GitHub Gist',
        usage: 'gist pull [gist-id-or-url]',
    })
    .args([
        arg(
            'gistId',
            z
                .string()
                .optional()
                .refine((v) => !v || !!resolveGistId(v), 'Must be a valid Gist ID or URL')
                .describe('Gist ID or URL (prompted if omitted)'),
        ),
    ])
    .run(
        commandValidator(async ({ args }) => {
            let gistIdOrUrl = args.gistId
            if (!gistIdOrUrl) {
                gistIdOrUrl = await input({
                    message: 'Enter Gist ID or URL',
                    validate: (v) => !!resolveGistId(v) || 'Must be a valid Gist ID or URL',
                })
            }

            const token = await ensureToken().catch(() => {
                logger.warn('Not authenticated — only public Gists can be fetched.')
                return undefined
            })

            await spinner({
                message: 'Fetching config from Gist...',
                task: async () => {
                    await pullGist(gistIdOrUrl!, token)
                },
            })

            logger.success(green(bold('Config loaded from Gist.')))
            logger.log(dim('  Run `bekk config show` to verify the loaded settings.'))
        }),
    )

// ─── gist (container) ─────────────────────────────────────────────────────────

export const gistCmd = app
    .sub('gist')
    .meta({ description: 'Sync config with GitHub Gist' })
    .command(pushCmd)
    .command(pullCmd)
