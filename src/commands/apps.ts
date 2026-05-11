import { commandValidator, flag } from '@crustjs/validate/zod'
import consola from 'consola'
import { destr } from 'destr'
import { join } from 'pathe'
import { z } from 'zod'

import { backupAllApps, formatAppListSummary, getAvailableProviders } from '#lib/apps'
import { analyzeApps, installApps } from '#lib/apps/restore'
import { getAppListsDir } from '#lib/paths'
import type { App } from '#lib/types'
import {
    bold,
    cyan,
    dim,
    green,
    red,
    yellow,
    multiselect,
    createTaskList,
    drawPanel,
} from '#lib/ui'

import { app } from '../app'

const appListsDir = getAppListsDir

const loadBackupAppLists = async (): Promise<Record<string, App[] | null>> => {
    const dir = appListsDir()
    const result: Record<string, App[] | null> = {}
    for (const provider of getAvailableProviders()) {
        const file = Bun.file(join(dir, `${provider.id}.json`))
        if (await file.exists()) {
            const text = await file.text()
            result[provider.id] = destr<App[]>(text)
        }
    }
    return result
}

// ─── apps (list) ──────────────────────────────────────────────────────────────

const appsListCmd = app
    .sub('apps')
    .sub('list')
    .meta({ description: 'List currently installed apps' })
    .run(async () => {
        const providers = getAvailableProviders()
        if (providers.length === 0) {
            consola.info('No package managers available on this platform.')
            return
        }

        for (const provider of providers) {
            const apps = await provider.list()
            if (apps === null || apps.length === 0) {
                console.log(dim(`${provider.name}: (no apps found)`))
                continue
            }
            console.log()
            console.log(bold(provider.name))
            for (const a of apps) {
                console.log(`  ${cyan(a.name)} ${dim(a.version)}`)
            }
        }
    })

// ─── apps backup ─────────────────────────────────────────────────────────────

const appsBackupCmd = app
    .sub('apps')
    .sub('backup')
    .meta({ description: 'Back up app lists to local storage' })
    .run(async () => {
        const providers = getAvailableProviders()
        if (providers.length === 0) {
            consola.info('No package managers available on this platform.')
            return
        }

        const taskList = await createTaskList()
        const taskIds: Record<string, string> = {}
        for (const p of providers) taskIds[p.id] = taskList.add(p.name)

        const result = await backupAllApps(appListsDir(), (providerId, state, count) => {
            const taskId = taskIds[providerId]
            if (!taskId) return
            if (state === 'start') taskList.update(taskId, 'running')
            else if (state === 'done') taskList.update(taskId, 'success', `${count} apps`)
            else if (state === 'error') taskList.update(taskId, 'error')
        })

        taskList.finish()
        console.log()
        console.log(`${green(bold('◉'))} App list backup  ${dim(formatAppListSummary(result))}`)
    })

// ─── apps restore ────────────────────────────────────────────────────────────

const appsRestoreCmd = app
    .sub('apps')
    .sub('restore')
    .meta({ description: 'Restore apps from backup' })
    .flags({
        'dry-run': flag(
            z.boolean().default(false).describe('Preview changes without installing anything'),
            { short: 'd' },
        ),
    })
    .run(
        commandValidator(async ({ flags }) => {
            const providers = getAvailableProviders()
            if (providers.length === 0) {
                consola.info('No package managers available on this platform.')
                return
            }

            const backup = await loadBackupAppLists()
            const hasAnyBackup = Object.values(backup).some((v) => v !== null && v.length > 0)
            if (!hasAnyBackup) {
                consola.error('No backed-up app lists found. Run `bekk apps backup` first.')
                return
            }

            console.log(dim('Analyzing backup against current environment...'))
            const analysis = await analyzeApps(backup, providers)

            // Show summary
            const summaryLines: string[] = []
            for (const a of analysis) {
                const provider = providers.find((p) => p.id === a.providerId)
                const name = provider?.name ?? a.providerId
                summaryLines.push(bold(name))
                summaryLines.push(`  Same version:     ${a.sameVersion.length}`)
                summaryLines.push(`  Different version: ${a.differentVersion.length}`)
                summaryLines.push(`  Missing:          ${a.missing.length}`)
                if (a.vanished.length > 0) {
                    summaryLines.push(`  ${yellow('Vanished:')}         ${a.vanished.length}`)
                }
            }
            console.log()
            drawPanel(summaryLines, { title: 'Restore Analysis' })

            // Show vanished warnings
            for (const a of analysis) {
                if (a.vanished.length === 0) continue
                const provider = providers.find((p) => p.id === a.providerId)
                console.log()
                console.log(yellow(bold(`⚠ Vanished from ${provider?.name ?? a.providerId}`)))
                console.log(dim('These packages are no longer available and cannot be installed:'))
                for (const app of a.vanished) {
                    console.log(`  ${red(app.name)} ${dim(app.version)}`)
                }
            }

            if (flags['dry-run']) {
                console.log()
                consola.info(dim('Dry run — no changes were made.'))
                return
            }

            // Collect selections
            const toInstall: { provider: (typeof providers)[0]; apps: App[] }[] = []
            const toUpdate: { provider: (typeof providers)[0]; apps: App[] }[] = []

            for (const a of analysis) {
                const provider = providers.find((p) => p.id === a.providerId)
                if (!provider) continue

                if (a.missing.length > 0) {
                    const chosen = await multiselect<string>({
                        message: `Select ${provider.name} apps to install`,
                        choices: a.missing.map((app) => ({
                            label: `${app.name} ${dim(app.version)}`,
                            value: app.name,
                        })),
                        default: a.missing.map((app) => app.name),
                    })
                    const apps = a.missing.filter((app) => chosen.includes(app.name))
                    if (apps.length > 0) toInstall.push({ provider, apps })
                }

                if (a.differentVersion.length > 0) {
                    const chosen = await multiselect<string>({
                        message: `Select ${provider.name} apps to update to latest`,
                        choices: a.differentVersion.map((d) => ({
                            label: `${d.backup.name} ${dim(d.backup.version)} → ${dim('latest')}`,
                            value: d.backup.name,
                        })),
                        default: [],
                    })
                    const apps = a.differentVersion
                        .filter((d) => chosen.includes(d.backup.name))
                        .map((d) => d.backup)
                    if (apps.length > 0) toUpdate.push({ provider, apps })
                }
            }

            const totalActions =
                toInstall.reduce((s, g) => s + g.apps.length, 0) +
                toUpdate.reduce((s, g) => s + g.apps.length, 0)

            if (totalActions === 0) {
                console.log()
                consola.info('No apps selected for installation.')
                return
            }

            // Execute installations
            console.log()
            const taskList = await createTaskList()
            let totalSucceeded = 0
            let totalFailed = 0

            for (const group of [...toInstall, ...toUpdate]) {
                for (const app of group.apps) {
                    const taskId = taskList.add(`${group.provider.name}: ${app.name}`)
                    taskList.update(taskId, 'running')
                    await installApps(group.provider, [app], (a, ok, err) => {
                        if (ok) {
                            taskList.update(taskId, 'success')
                            totalSucceeded++
                        } else {
                            taskList.update(taskId, 'error', err)
                            totalFailed++
                        }
                    })
                }
            }

            taskList.finish()
            console.log()
            console.log(
                `${green(bold('◉'))} Restore complete  ${green(`${totalSucceeded} succeeded`)}${totalFailed > 0 ? `, ${red(`${totalFailed} failed`)}` : ''}`,
            )
        }),
    )

// ─── apps (top-level container) ──────────────────────────────────────────────

export const appsCmd = app
    .sub('apps')
    .meta({ description: 'Manage app lists and installations' })
    .command(appsListCmd)
    .command(appsBackupCmd)
    .command(appsRestoreCmd)
    .run(async () => {
        // Default when no subcommand given: show usage help
        const providers = getAvailableProviders()
        console.log(bold('App List Management'))
        console.log()
        console.log(dim('Available package managers:'))
        if (providers.length === 0) {
            console.log(dim('  (none for this platform)'))
        } else {
            for (const p of providers) {
                console.log(`  ${p.name} ${dim(`(${p.id})`)}`)
            }
        }
        console.log()
        console.log(dim('Subcommands:'))
        console.log(`  bekk apps list    ${dim('— list currently installed apps')}`)
        console.log(`  bekk apps backup  ${dim('— back up app lists')}`)
        console.log(`  bekk apps restore ${dim('— restore apps from backup')}`)
    })
