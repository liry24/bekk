import { normalize } from 'pathe'

import { changeRepoPassword, promptPassword, resolveRepoPassword } from '#lib/secrets'
import {
    bold,
    dim,
    green,
    yellow,
    red,
    input,
    multiselect,
    password,
    spinner,
    confirm,
    select,
    writeString,
} from '#lib/ui'

import { configStore } from '../../store'

export const configureDestination = async () => {
    const cfg = await configStore.read()
    const raw = await input({
        message: 'Backup destination path',
        default: cfg.repoPath || undefined,
        placeholder: '/path/to/repo or S3 URL',
    })
    const path = normalize(raw.trim())
    await configStore.patch({ repoPath: path })
    writeString(green(`Backup destination set: ${bold(path)}`))
}

export const configureSources = async () => {
    const cfg = await configStore.read()

    const action = await select<'add' | 'remove'>({
        message: 'Source paths',
        choices: [
            {
                label: 'Add a path',
                value: 'add',
            },
            {
                label: 'Remove paths',
                value: 'remove',
                hint: cfg.sourcePaths.length > 0 ? `${cfg.sourcePaths.length} configured` : 'none',
            },
        ],
    })

    if (action === 'add') {
        writeString(dim('Enter paths to add (leave blank to finish):'))
        while (true) {
            const raw = await input({
                message: 'Add source path',
                placeholder: 'Leave empty to finish',
            })
            const trimmed = raw.trim()
            if (!trimmed) break
            const path = normalize(trimmed)
            await configStore.update((c) => {
                if (c.sourcePaths.includes(path)) return c
                return { ...c, sourcePaths: [...c.sourcePaths, path] }
            })
        }
    } else {
        const fresh = await configStore.read()
        if (fresh.sourcePaths.length === 0) {
            writeString(dim('No source paths configured.'))
            return
        }
        const toRemove = await multiselect<string>({
            message: 'Select paths to remove (Space to toggle, Enter to confirm)',
            choices: fresh.sourcePaths.map((p) => ({ label: p, value: p })),
            default: [],
        })
        if (toRemove.length > 0) {
            await configStore.update((c) => ({
                ...c,
                sourcePaths: c.sourcePaths.filter((p) => !toRemove.includes(p)),
            }))
            writeString(green(`Removed ${toRemove.length} path(s).`))
        }
    }
}

export const changePassword = async () => {
    const { repoPath, savedPassword } = await configStore.read()

    if (!repoPath) {
        writeString(red('No backup destination configured. Run `bekk config` first.'))
        return
    }

    const oldPassword = await resolveRepoPassword()
    if (!oldPassword) {
        writeString(red('Could not resolve current repository password.'))
        return
    }

    const { password: newPassword, wasGenerated } = await promptPassword(password)

    const saveInConfig = await confirm({
        message: 'Save password to config file?',
        default: savedPassword !== '',
        active: 'Yes  (⚠ synced to Gist/S3 as plaintext)',
        inactive: 'No  (OS credential manager only — recommended)',
    })

    await spinner({
        message: 'Updating repository encryption key…',
        task: async ({ updateMessage }) => {
            await changeRepoPassword({
                repo: repoPath,
                oldPassword,
                newPassword,
                saveToConfig: saveInConfig,
            })
            updateMessage(green('Repository encryption key updated.'))
        },
    })

    if (wasGenerated) {
        writeString('')
        writeString(yellow(bold('New auto-generated password:')))
        writeString('  ' + bold(newPassword))
        writeString(dim('  Keep this safe — it is required to restore your backups.'))
    }
    writeString(green('Password updated.'))
}
