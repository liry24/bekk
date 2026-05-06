import { existsSync } from 'node:fs'

import { confirm, input, select } from '@crustjs/prompts'
import { bold, dim, green, red, table } from '@crustjs/style'
import { arg, commandValidator, promptValidator } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { app } from '../app'
import { normalizePath } from '../lib/pathUtils'
import { configStore } from '../store'

const pathSchema = z.string().min(1, 'Path is required')

// ─── config show ──────────────────────────────────────────────────────────────

const showCmd = app
    .sub('config')
    .sub('show')
    .meta({ description: 'Show current configuration' })
    .run(async () => {
        const cfg = await configStore.read()

        console.log(bold('Destination:'), green(cfg.destinationRoot || dim('(not set)')))
        console.log()

        console.log(bold('Sources:'), cfg.sourcePaths.length === 0 ? dim('(not set)') : '')
        if (cfg.sourcePaths.length !== 0) for (const p of cfg.sourcePaths) console.log('  ' + p)

        console.log()

        console.log(bold('Local Data Backup Options:'))
        console.log(
            table(
                ['Option', 'Value', 'Description'],
                [
                    [
                        'mirror',
                        String(cfg.robocopyMirror),
                        'delete destination files not present in source',
                    ],
                    [
                        'retryCount',
                        String(cfg.robocopyRetryCount),
                        'number of retries on failed file copy',
                    ],
                    ['retryWait', String(cfg.robocopyRetryWait), 'seconds to wait between retries'],
                    [
                        'excludeJunctions',
                        String(cfg.robocopyExcludeJunctions),
                        'skip symbolic links and junctions',
                    ],
                ],
            ),
        )
        console.log()

        const srcLabel =
            cfg.wingetIncludeSources.length > 0
                ? cfg.wingetIncludeSources.map((s) => (s === '' ? dim('(blank)') : s)).join(', ')
                : dim('(none — winget apps will not be backed up)')
        console.log(bold('App List Backup (winget sources):'), srcLabel)
        console.log()

        console.log(bold('GitHub Gist ID:'), cfg.gistId || dim('(not set)'))
    })

// ─── config add ───────────────────────────────────────────────────────────────

const addCmd = app
    .sub('config')
    .sub('add')
    .meta({
        description: 'Add a backup source path',
        usage: 'config add <path>',
    })
    .args([arg('path', z.string().min(1, 'Path is required').describe('Folder path to add'))])
    .run(
        commandValidator(async ({ args }) => {
            const path = normalizePath(args.path)
            // Existence check after schema validation
            if (!existsSync(path)) consola.warn(`Warning: path does not currently exist: ${path}`)

            const cfg = await configStore.read()
            if (cfg.sourcePaths.includes(path)) {
                consola.info(`Already added: ${path}`)
                return
            }
            await configStore.update((c) => ({ ...c, sourcePaths: [...c.sourcePaths, path] }))
            consola.success(green(`Added: ${bold(path)}`))
        }),
    )

// ─── config remove ────────────────────────────────────────────────────────────

const removeCmd = app
    .sub('config')
    .sub('remove')
    .meta({ description: 'Remove a backup source path' })
    .run(async () => {
        const cfg = await configStore.read()
        if (cfg.sourcePaths.length === 0) {
            consola.info(dim('No source paths configured.'))
            return
        }
        const target = await select<string>({
            message: 'Select path to remove',
            choices: cfg.sourcePaths,
        })
        await configStore.update((c) => ({
            ...c,
            sourcePaths: c.sourcePaths.filter((p) => p !== target),
        }))
        consola.success(green(`Removed: ${bold(target)}`))
    })

// ─── config dest ──────────────────────────────────────────────────────────

const destCmd = app
    .sub('config')
    .sub('dest')
    .meta({
        description: 'Set backup destination path',
        usage: 'config dest <path>',
    })
    .args([arg('path', pathSchema.describe('Backup destination path'))])
    .run(
        commandValidator(async ({ args }) => {
            const path = normalizePath(args.path)
            if (!existsSync(path)) {
                consola.error(red(`Path does not exist: ${path}`))
                process.exit(1)
            }
            await configStore.patch({ destinationRoot: path })
            consola.success(green(`Destination set: ${bold(path)}`))
        }),
    )

// ─── config data ────────────────────────────────────────────────────────────

const dataCmd = app
    .sub('config')
    .sub('data')
    .meta({ description: 'Configure local data backup (robocopy) options' })
    .run(async () => {
        const cfg = await configStore.read()

        console.log(dim('Current values shown. Press Enter to keep unchanged.'))
        console.log()

        const mirrorStr = await confirm({
            message: 'Mirror mode: delete destination files not present in source',

            default: cfg.robocopyMirror,
        })

        const retryCountStr = await input({
            message: 'Number of retries on failed file copy',

            default: String(cfg.robocopyRetryCount),
            validate: promptValidator(z.coerce.number().int().min(0).max(999)),
        })

        const retryWaitStr = await input({
            message: 'Seconds to wait between retries',

            default: String(cfg.robocopyRetryWait),
            validate: promptValidator(z.coerce.number().int().min(0).max(9999)),
        })

        const excludeJunctions = await confirm({
            message: 'Skip symbolic links and junctions',

            default: cfg.robocopyExcludeJunctions,
        })

        await configStore.patch({
            robocopyMirror: mirrorStr,
            robocopyRetryCount: parseInt(retryCountStr, 10),
            robocopyRetryWait: parseInt(retryWaitStr, 10),
            robocopyExcludeJunctions: excludeJunctions,
        })

        consola.success(green('Local data backup options saved.'))
    })

// ─── config apps ─────────────────────────────────────────────────────────────

const appsCmd = app
    .sub('config')
    .sub('apps')
    .meta({ description: 'Configure which winget sources to include in app list backup' })
    .run(async () => {
        const cfg = await configStore.read()
        const current = cfg.wingetIncludeSources

        console.log(bold('=== App List Backup Settings ==='))
        console.log(dim('Choose which winget sources to include in the backup.'))
        console.log(dim('Current sources: ' + (current.join(', ') || '(none)')))
        console.log()

        const includeWinget = await confirm({
            message: 'Include apps from the winget source (community repository)',
            default: current.includes('winget'),
        })

        const includeMsstore = await confirm({
            message: 'Include apps from the msstore source (Microsoft Store)',
            default: current.includes('msstore'),
        })

        const includeBlank = await confirm({
            message: 'Include apps with no source (e.g. sideloaded or custom installers)',
            default: current.includes(''),
        })

        const sources: string[] = []
        if (includeWinget) sources.push('winget')
        if (includeMsstore) sources.push('msstore')
        if (includeBlank) sources.push('')

        await configStore.patch({ wingetIncludeSources: sources })

        console.log()
        consola.success(green('App backup settings saved.'))
    })

// ─── config (container) ───────────────────────────────────────────────────────

export const configCmd = app
    .sub('config')
    .meta({ description: 'Manage configuration' })
    .command(showCmd)
    .command(addCmd)
    .command(removeCmd)
    .command(destCmd)
    .command(dataCmd)
    .command(appsCmd)
