import { isAbsolute, normalize } from 'pathe'

import { bekkCore } from '#bekk-core'
import {
    getGitHubToken,
    promptPassword,
    setRepoPassword,
    setS3SecretAccessKey,
} from '#lib/secrets'
import type { S3Destination } from '#lib/types'
import {
    bold,
    cyan,
    dim,
    drawPanel,
    green,
    yellow,
    confirm,
    input,
    multiselect,
    password,
    select,
    spinner,
    writeString,
} from '#lib/ui'

import { app } from '../app'
import { configStore } from '../store'

// ─── helpers ──────────────────────────────────────────────────────────────────

const validatePath = (value: string, allowRelative = false): true | string => {
    const trimmed = value.trim()
    if (trimmed.includes('\0')) return 'Path cannot contain null bytes'
    if (!allowRelative && !isAbsolute(trimmed)) return 'Path must be absolute'
    return true
}

const validateUrl = (value: string): true | string => {
    const trimmed = value.trim()
    if (!trimmed) return true
    try {
        const url = new URL(trimmed)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return 'Endpoint must use http:// or https://'
        }
        return true
    } catch {
        return 'Invalid URL format'
    }
}

async function collectSourcePaths(): Promise<string[]> {
    writeString(dim('Enter source paths to back up (leave empty to finish):'))
    const sourcePaths: string[] = []
    while (true) {
        const raw = await input({
            message: 'Add source path',
            placeholder: 'Leave empty to finish',
            validate: (v) => {
                const trimmed = v.trim()
                if (!trimmed) return true
                return validatePath(trimmed, true)
            },
        })
        const trimmed = raw.trim()
        if (!trimmed) break
        const path = normalize(trimmed)
        if (!sourcePaths.includes(path)) {
            sourcePaths.push(path)
            writeString(green(`Added: ${bold(path)}`))
        } else {
            writeString(dim('Already added.'))
        }
    }
    return sourcePaths
}

async function collectS3Destinations(): Promise<S3Destination[]> {
    const destinations: S3Destination[] = []
    let addMore = true
    while (addMore) {
        writeString('')
        writeString(bold('Add S3 destination'))

        const defaultName = 's3'
        const name = await input({
            message: `  Name  ${dim('(used to identify this destination)')}`,
            placeholder: defaultName,
            validate: (v) => {
                if (!v.trim()) return 'Name is required'
                if (destinations.some((d) => d.name === v.trim()))
                    return 'A destination with this name already exists'
                return true
            },
        })

        const bucket = await input({
            message: `  Bucket  ${dim('(S3 bucket name)')}`,
            placeholder: name.trim(),
            validate: (v) => (v.trim() ? true : 'Bucket is required'),
        })

        const endpoint = await input({
            message: `  Endpoint  ${dim('(leave blank for AWS standard)')}`,
            placeholder: 'e.g. https://accountid.r2.cloudflarestorage.com',
            validate: validateUrl,
        })

        const region = await input({
            message: `  Region`,
            placeholder: 'us-east-1',
        })

        const accessKeyId = await input({
            message: `  Access Key ID`,
            validate: (v) => (v.trim() ? true : 'Access Key ID is required'),
        })

        const secretAccessKey = await password({
            message: `  Secret Access Key`,
            validate: (v) => (v.trim() ? true : 'Secret Access Key is required'),
        })

        const dest: S3Destination = {
            name: name.trim(),
            bucket: bucket.trim(),
            region: region.trim() || 'us-east-1',
            endpoint: endpoint.trim(),
            accessKeyId: accessKeyId.trim(),
        }
        destinations.push(dest)
        await setS3SecretAccessKey(dest.name, secretAccessKey)

        writeString(green(`S3 destination ${cyan(bold(dest.name))} configured.`))

        addMore = await select<boolean>({
            message: 'Add another S3 destination?',
            choices: [
                { label: 'No', value: false },
                { label: 'Yes', value: true },
            ],
        })
    }
    return destinations
}

interface InitSetup {
    repoPath: string
    storageType: 'local' | 'rclone'
    password: string
    wasGenerated: boolean
    savePasswordInConfig: boolean
    snapshotLimit: number
    sourcePaths: string[]
    gistEnabled: boolean
    s3Destinations: S3Destination[]
    sameConfiguredRepo: boolean
}

function buildPreviewLines(setup: InitSetup): string[] {
    const lines: string[] = []

    lines.push(`${dim('Destination:')}  ${setup.repoPath}`)
    lines.push(`${dim('Type:')}          ${setup.storageType}`)
    lines.push(
        `${dim('Password:')}      ${setup.wasGenerated ? yellow('auto-generated') : dim('custom')}`,
    )
    lines.push(
        `${dim('Saved in config:')} ${setup.savePasswordInConfig ? yellow('Yes') : green('No')}`,
    )
    lines.push(`${dim('Snapshot limit:')} ${setup.snapshotLimit}`)
    lines.push(
        `${dim('Sources:')}       ${setup.sourcePaths.length > 0 ? setup.sourcePaths.join(', ') : dim('(none)')}`,
    )

    const syncParts: string[] = []
    if (setup.gistEnabled) syncParts.push('Gist')
    if (setup.s3Destinations.length > 0) syncParts.push(`${setup.s3Destinations.length} S3`)
    lines.push(
        `${dim('Sync:')}          ${syncParts.length > 0 ? syncParts.join(', ') : dim('(none)')}`,
    )

    return lines
}

// ─── command ──────────────────────────────────────────────────────────────────

export const initCmd = app
    .sub('init')
    .meta({ description: 'Set up a new backup destination' })
    .run(async () => {
        // ── Phase 1: Collect all settings ──────────────────────────────────────

        const existing = await configStore.read()
        if (existing.repoPath) {
            writeString(yellow(bold('Backup is already configured.')))
            writeString(
                dim('Running init again will walk through setup and reinitialize the repo.'),
            )
            writeString(dim(`Current repo: ${existing.repoPath}`))

            const shouldReinitialize = await confirm({
                message: 'Run init again and reinitialize the backup destination?',
                default: false,
                active: 'Yes  (run setup again)',
                inactive: 'No  (cancel)',
            })

            if (!shouldReinitialize) return
        }

        const storageType = await select<'local' | 'rclone'>({
            message: 'Where would you like to save your backups?',
            choices: [
                { label: 'Local folder  (on this machine)', value: 'local' },
                { label: 'Cloud storage (via rclone)', value: 'rclone' },
            ],
        })

        let repoPath: string
        if (storageType === 'local') {
            const placeholder =
                process.platform === 'win32'
                    ? 'e.g. D:\\Backups\\bekk'
                    : process.platform === 'darwin'
                      ? 'e.g. /Volumes/Backup/bekk'
                      : 'e.g. /mnt/backup/bekk'
            repoPath = await input({
                message: `Local folder path  ${dim(placeholder)}`,
                validate: (v) => {
                    const trimmed = v.trim()
                    if (!trimmed) return 'Path is required'
                    return validatePath(trimmed)
                },
            })
        } else {
            writeString(dim('  rclone remote paths look like:  myremote:bucket/folder'))
            writeString(dim('  Run `rclone config` to manage remotes.'))
            repoPath = await input({
                message: 'rclone path  (e.g. myremote:bucket/bekk)',
                validate: (v) => {
                    const trimmed = v.trim()
                    if (!trimmed) return 'Path is required'
                    if (trimmed.includes('\0')) return 'Path cannot contain null bytes'
                    return true
                },
            })
        }

        console.log()
        console.log(dim('A password is used to encrypt your backups.'))
        console.log(dim('Leave it blank to have bekk generate and manage one for you.'))

        const { password: resolvedPassword, wasGenerated } = await promptPassword(password)

        writeString('')
        writeString(dim('Your password will be stored in the OS credential manager.'))
        writeString(dim('⚠ Saving to config makes it available for scripts,'))
        writeString(dim('but the password will be synced as plaintext to any enabled storage.'))
        const savePasswordInConfig = await confirm({
            message: 'Also save password to config file?',
            default: false,
            active: 'Yes  (⚠ synced to Gist/S3 as plaintext)',
            inactive: 'No  (OS credential manager only — recommended)',
        })

        const snapshotLimitInput = await input({
            message: `Snapshot retention limit  ${dim('(oldest snapshots are deleted)')}`,
            default: '1',
            validate: (v) => {
                const n = Number(v)
                return Number.isInteger(n) && n >= 1 ? true : 'Must be a positive integer (min 1)'
            },
        })
        const snapshotLimit = Number(snapshotLimitInput)

        console.log()
        const sourcePaths = await collectSourcePaths()

        const normalizedRepo = normalize(repoPath)
        const sameConfiguredRepo = existing.repoPath !== '' && normalizedRepo === existing.repoPath

        if (sameConfiguredRepo) {
            writeString('')
            writeString(yellow(bold('Warning: the selected repo is already configured.')))
            writeString(
                dim(
                    'Reinitializing the same repo directory will remove its current repository data.',
                ),
            )

            const shouldReuseRepo = await confirm({
                message: 'Continue and delete the current repo contents before reinitializing?',
                default: false,
                active: 'Yes  (delete and reinitialize)',
                inactive: 'No  (cancel)',
            })

            if (!shouldReuseRepo) return
        }

        writeString('')
        writeString(dim('You can optionally sync your config and app lists to Gist or S3.'))
        writeString(dim('You can skip this and set it up later with `bekk gist login`.'))
        writeString('')

        const backendChoices = await multiselect<'gist' | 's3'>({
            message: 'Enable sync backends (space to toggle, enter to confirm)',
            choices: [
                { label: 'GitHub Gist', value: 'gist' },
                { label: 'S3 / compatible (R2, MinIO...)', value: 's3' },
            ],
        })

        let gistEnabled = false
        let s3Destinations: S3Destination[] = []

        if (backendChoices.includes('gist')) {
            const token = await getGitHubToken()
            if (token) {
                gistEnabled = true
            } else {
                writeString(
                    'Not authenticated with GitHub. ' +
                        dim('Run `bekk gist login` to enable Gist sync.'),
                )
            }
        }

        if (backendChoices.includes('s3')) {
            s3Destinations = await collectS3Destinations()
        }

        // ── Phase 2: Preview ───────────────────────────────────────────────────

        const setup: InitSetup = {
            repoPath,
            storageType,
            password: resolvedPassword,
            wasGenerated,
            savePasswordInConfig,
            snapshotLimit,
            sourcePaths,
            gistEnabled,
            s3Destinations,
            sameConfiguredRepo,
        }

        writeString('')
        await drawPanel(buildPreviewLines(setup), { title: 'Setup Preview' })

        const confirmed = await confirm({
            message: 'Create backup destination with these settings?',
            default: true,
            active: 'Yes  (create destination)',
            inactive: 'No  (cancel)',
        })
        if (!confirmed) {
            writeString(dim('Setup cancelled.'))
            return
        }

        // ── Phase 3: Persist ───────────────────────────────────────────────────

        let initOk = false
        await spinner({
            message: 'Setting up backup destination...',
            task: async () => {
                const initialized = await bekkCore.initializeRepository({
                    repoPath,
                    password: resolvedPassword,
                    forceReinit: sameConfiguredRepo,
                })
                if (initialized.initResult.status === 'error')
                    throw new Error(initialized.initResult.message)
                await configStore.write({ ...initialized.nextConfig, snapshotLimit, sourcePaths })
                await setRepoPassword(resolvedPassword, { saveToConfig: savePasswordInConfig })
                initOk = true
            },
        })
        if (!initOk) return

        if (gistEnabled || s3Destinations.length > 0) {
            await configStore.patch({
                gistEnabled,
                s3DestinationsJson: JSON.stringify(s3Destinations),
            })
        }

        writeString('')
        writeString(green(bold('Backup setup complete')))

        if (wasGenerated) {
            writeString('')
            writeString(
                yellow(bold('Auto-generated backup password:')) +
                    ' ' +
                    cyan(bold(resolvedPassword)),
            )
            writeString(dim('This password is stored in your OS credential manager.'))
            writeString(dim('⚠  Keep a copy somewhere safe — it is required to restore backups.'))
        }

        writeString('')
        writeString(dim('Manage sources:      ') + bold('bekk config'))
        writeString(dim('Run backup:          ') + bold('bekk backup'))
        writeString(
            gistEnabled
                ? dim('Push to sync:        ') + bold('bekk push')
                : dim('Set up Gist sync:    ') + bold('bekk gist login'),
        )
    })
