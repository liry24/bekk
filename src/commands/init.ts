import { spinner } from '@crustjs/progress'
import { confirm, input, multiselect, password, select } from '@crustjs/prompts'
import { bold, cyan, dim, green, yellow } from '@crustjs/style'
import consola from 'consola'
import { normalize } from 'pathe'

import { bekkCore } from '#bekk-core'
import { cliLog } from '#lib/log'
import { generatePassword, setRepoPassword, setS3SecretAccessKey } from '#lib/secrets'
import type { S3Destination } from '#lib/sync'

import { app } from '../app'
import { authStore, configStore } from '../store'

export const initCmd = app
    .sub('init')
    .meta({ description: 'Set up a new backup destination' })
    .run(async () => {
        const existing = await configStore.read()
        if (existing.repoPath) {
            console.log(yellow(bold('Backup is already configured.')))
            console.log(
                dim('Running init again will walk through setup and reinitialize the repo.'),
            )
            console.log(dim(`Current repo: ${existing.repoPath}`))

            const shouldReinitialize = await confirm({
                message: 'Run init again and reinitialize the backup destination?',
                default: false,
                active: 'Yes  (run setup again)',
                inactive: 'No  (cancel)',
            })

            if (!shouldReinitialize) return
        }

        // ── Step 1: Where to save backups ──────────────────────────────────────
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
                validate: (v) => (v.trim() ? true : 'Path is required'),
            })
        } else {
            console.log(dim('  rclone remote paths look like:  myremote:bucket/folder'))
            console.log(dim('  Run `rclone config` to manage remotes.'))
            repoPath = await input({
                message: 'rclone path  (e.g. myremote:bucket/bekk)',
                validate: (v) => (v.trim() ? true : 'Path is required'),
            })
        }

        // ── Step 2: Backup password ────────────────────────────────────────────
        console.log()
        console.log(dim('A password is used to encrypt your backups.'))
        console.log(dim('Leave it blank to have bekk generate and manage one for you.'))

        const enteredPassword = await password({
            message: 'Backup password  (press Enter to auto-generate)',
        })

        let resolvedPassword: string
        let wasGenerated = false

        if (enteredPassword.trim()) {
            const confirmed = await password({
                message: 'Confirm backup password',
                validate: (v) => (v === enteredPassword ? true : 'Passwords do not match'),
            })
            void confirmed
            resolvedPassword = enteredPassword
        } else {
            resolvedPassword = generatePassword()
            wasGenerated = true
        }

        // ── Step 2b: Save password to config? ────────────────────────────────────
        cliLog({
            messages: [
                dim('Your password will be stored in the OS credential manager.'),
                dim('⚠ Saving to config makes it available for scripts,'),
                dim('but the password will be synced as plaintext to any enabled storage.'),
            ],
            padding: { side: 'top' },
        })
        const savePasswordInConfig = await confirm({
            message: 'Also save password to config file?',
            default: false,
            active: 'Yes  (⚠ synced to Gist/S3 as plaintext)',
            inactive: 'No  (OS credential manager only — recommended)',
        })

        // ── Step 3: Initialize ─────────────────────────────────────────────────
        const normalizedRepo = normalize(repoPath)
        const sameConfiguredRepo = Boolean(
            existing.repoPath && normalizedRepo === existing.repoPath,
        )

        if (sameConfiguredRepo) {
            cliLog({
                messages: [
                    yellow(bold('Warning: the selected repo is already configured.')),
                    dim(
                        'Reinitializing the same repo directory will remove its current repository data.',
                    ),
                ],
                padding: { side: 'bottom' },
            })

            const shouldReuseRepo = await confirm({
                message: 'Continue and delete the current repo contents before reinitializing?',
                default: false,
                active: 'Yes  (delete and reinitialize)',
                inactive: 'No  (cancel)',
            })

            if (!shouldReuseRepo) return
        }

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
                await configStore.write(initialized.nextConfig)
                await setRepoPassword(resolvedPassword, { saveToConfig: savePasswordInConfig })
                initOk = true
            },
        })
        if (!initOk) return

        console.log()
        consola.success(green(bold('Backup setup complete')))

        if (wasGenerated)
            cliLog({
                messages: [
                    [yellow(bold('Auto-generated backup password:')), cyan(bold(resolvedPassword))],
                    dim('This password is stored in your OS credential manager.'),
                    dim('⚠  Keep a copy somewhere safe — it is required to restore backups.'),
                ],
                padding: { side: 'top' },
            })

        // ── Step 4: Sync backends ──────────────────────────────────────────────
        cliLog({
            messages: [
                dim('You can optionally sync your config and app lists to Gist or S3.'),
                dim('You can skip this and set it up later with `bekk gist login`.'),
            ],
            padding: { side: 'both' },
        })

        const backendChoices = await multiselect<'gist' | 's3'>({
            message: 'Enable sync backends (space to toggle, enter to confirm)',
            choices: [
                { label: 'GitHub Gist', value: 'gist' },
                { label: 'S3 / compatible (R2, MinIO...)', value: 's3' },
            ],
        })

        let gistEnabled = false
        const s3Destinations: S3Destination[] = []

        if (backendChoices.includes('gist')) {
            const { token } = await authStore.read()
            if (token) {
                gistEnabled = true
                consola.success(green('Gist sync enabled.'))
            } else {
                consola.info(
                    'Not authenticated with GitHub. ' +
                        dim('Run `bekk gist login` to enable Gist sync.'),
                )
            }
        }

        if (backendChoices.includes('s3')) {
            let addMore = true
            while (addMore) {
                cliLog({
                    messages: [bold('Add S3 destination')],
                    padding: { side: 'top' },
                })

                const defaultName = 's3'
                const name = await input({
                    message: `  Name  ${dim('(used to identify this destination)')}`,
                    placeholder: defaultName,
                    validate: (v) => {
                        if (!v.trim()) return 'Name is required'
                        if (s3Destinations.some((d) => d.name === v.trim()))
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
                s3Destinations.push(dest)
                await setS3SecretAccessKey(dest.name, secretAccessKey)

                cliLog({
                    messages: [green(`S3 destination ${cyan(bold(dest.name))} configured.`)],
                    type: 'success',
                })

                addMore = await select<boolean>({
                    message: 'Add another S3 destination?',
                    choices: [
                        { label: 'No', value: false },
                        { label: 'Yes', value: true },
                    ],
                })
            }
        }

        if (gistEnabled || s3Destinations.length > 0)
            await configStore.patch({
                gistEnabled,
                s3DestinationsJson: JSON.stringify(s3Destinations),
            })

        cliLog({
            messages: [
                [dim('Add backup sources:  '), bold('bekk config')],
                [dim('Run backup:          '), bold('bekk backup')],
                gistEnabled
                    ? [dim('Push to sync:        '), bold('bekk push')]
                    : [dim('Set up Gist sync:    '), bold('bekk gist login')],
            ],
            padding: { side: 'top' },
        })
    })
