import { existsSync } from 'node:fs'

import { input } from '@crustjs/prompts'
import { bold, dim, green } from '@crustjs/style'

import { app } from '../app'
import { normalizePath } from '../lib/pathUtils'
import { configStore } from '../store'

export const initCmd = app
    .sub('init')
    .meta({ description: 'Initialize configuration' })
    .run(async () => {
        const existing = await configStore.read()
        if (existing.destinationRoot) {
            console.log(bold('Configuration already exists.'))
            console.log(dim('Use `bekk config dest` / `bekk config robocopy` to update.'))
            return
        }

        console.log(bold('=== bekk Init ==='))
        console.log()

        const destinationRoot = await input({
            message: 'Backup destination path (e.g. D:\\Backup)',
            validate: (v) => {
                if (!v) return 'Path is required'
                const norm = normalizePath(v)
                // UNC: \\server\share or //server/share
                if (norm.startsWith('//')) {
                    const parts = norm.replace(/^\/\//, '').split('/').filter(Boolean)
                    if (parts.length < 2)
                        return 'Path must be in the form \\\\server\\share or //server/share'
                    const exists = existsSync(`\\\\${parts[0]}\\${parts[1]}`)
                    return exists || 'Path is not accessible. Ensure the network share exists.'
                }
                const match = norm.match(/^([A-Za-z]:)/)
                if (!match) return 'Path must start with a drive letter (e.g. D:\\) or UNC path'
                const exists = existsSync(match[1]! + '/')
                return exists || 'Path is not accessible. Ensure the drive exists.'
            },
        })

        await configStore.write({
            sourcePaths: [],
            destinationRoot: normalizePath(destinationRoot),
            gistId: '',
            robocopyMirror: true,
            robocopyRetryCount: 3,
            robocopyRetryWait: 5,
            robocopyExcludeJunctions: true,
            wingetIncludeSources: ['winget', 'msstore'],
        })

        console.log()
        console.log(green('✓ ' + bold('Initialized')))
        console.log(dim('  Add backup sources:') + '  bekk config add <path>')
        console.log(dim('  Set up Gist sync:  ') + '  bekk gist login')
    })
