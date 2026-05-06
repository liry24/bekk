import { confirm, input, select } from '@crustjs/prompts'
import { bold, cyan, dim, green, red, table, yellow } from '@crustjs/style'
import { promptValidator } from '@crustjs/validate/zod'
import consola from 'consola'
import { z } from 'zod'

import { app } from '../app'
import { isAdmin } from '../lib/admin'

const DEFAULT_TASK_NAME = 'BekkBackup'

// ─── schedule register ────────────────────────────────────────────────────────

const registerCmd = app
    .sub('schedule')
    .sub('register')
    .meta({ description: 'Register backup task in Task Scheduler' })
    .run(async () => {
        const admin = isAdmin()

        console.log(bold(cyan('=== Task Scheduler Registration ===')))
        console.log()
        if (admin) {
            console.log(green('  [Admin] Task will run as SYSTEM (no login required).'))
        } else {
            console.log(yellow('  [User] Task will run as the current user.'))
            console.log(dim('  Run as administrator to register as SYSTEM.'))
        }
        console.log()

        const taskName = await input({
            message: 'Task name',
            default: DEFAULT_TASK_NAME,
            validate: promptValidator(z.string().min(1, 'Task name is required')),
        })

        // Check for SYSTEM task collision
        if (!admin) {
            const checkResult = Bun.spawnSync(
                [
                    'powershell',
                    '-NoProfile',
                    '-Command',
                    `$t = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; if ($t) { $t.Principal.UserId } else { '' }`,
                ],
                { stdout: 'pipe', stderr: 'pipe' },
            )
            const taskUser = new TextDecoder().decode(checkResult.stdout).trim()
            if (taskUser === 'SYSTEM') {
                consola.error(
                    `Task '${taskName}' is already registered as SYSTEM. Run as administrator.`,
                )
                process.exit(1)
            }
        }

        const binaryPath = process.argv[0]!
        const exePath = await input({
            message: 'Path to bekk binary',
            default: binaryPath,
            validate: promptValidator(z.string().min(1)),
        })

        const triggerType = await select({
            message: 'Select trigger type',
            choices: [
                { label: 'Daily (at a time)', value: 'daily' },
                { label: 'Weekly (day + time)', value: 'weekly' },
                { label: 'At startup', value: 'startup' },
            ],
        })

        let triggerDesc = ''
        let triggerScript = ''

        if (triggerType === 'daily') {
            const time = await input({
                message: 'Run time (e.g. 02:00)',
                validate: promptValidator(z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format')),
            })
            triggerScript = `New-ScheduledTaskTrigger -Daily -At '${time}'`
            triggerDesc = `Daily ${time}`
        } else if (triggerType === 'weekly') {
            const day = await select({
                message: 'Select day of week',
                choices: [
                    'Sunday',
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                ],
            })
            const time = await input({
                message: 'Run time (e.g. 02:00)',
                validate: promptValidator(z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format')),
            })
            triggerScript = `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${day} -At '${time}'`
            triggerDesc = `Weekly ${day} ${time}`
        } else {
            triggerScript = `New-ScheduledTaskTrigger -AtStartup`
            triggerDesc = 'At startup'
        }

        const runAs = admin ? 'SYSTEM' : (process.env.USERNAME ?? 'CurrentUser')

        console.log()
        console.log(bold(cyan('=== Registration Summary ===')))
        console.log(
            table(
                ['Field', 'Value'],
                [
                    ['Task name', taskName],
                    ['Binary', exePath],
                    ['Trigger', triggerDesc],
                    ['Run as', runAs],
                ],
            ),
        )
        console.log()

        const ok = await confirm({ message: 'Register with these settings?', default: true })
        if (!ok) {
            console.log(dim('Cancelled.'))
            return
        }

        const psScript = `
$trigger = ${triggerScript}
$action = New-ScheduledTaskAction -Execute '${exePath}' -Argument 'run'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
${
    admin
        ? `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -Force -ErrorAction Stop`
        : `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop`
}
`.trim()

        const result = Bun.spawnSync(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
            { stdout: 'pipe', stderr: 'pipe' },
        )

        if (result.exitCode !== 0) {
            const errText = new TextDecoder().decode(result.stderr).trim()
            consola.error(`Failed to register task:\n${errText}`)
            process.exit(1)
        }

        console.log(green(`✓ Task '${bold(taskName)}' registered as ${runAs} (${triggerDesc})`))
    })

// ─── schedule unregister ──────────────────────────────────────────────────────

const unregisterCmd = app
    .sub('schedule')
    .sub('unregister')
    .meta({ description: 'Remove backup task from Task Scheduler' })
    .run(async () => {
        const admin = isAdmin()

        const taskName = await input({
            message: 'Task name to remove',
            default: DEFAULT_TASK_NAME,
            validate: promptValidator(z.string().min(1, 'Task name is required')),
        })

        // Get task info
        const infoResult = Bun.spawnSync(
            [
                'powershell',
                '-NoProfile',
                '-Command',
                `$t = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; if ($t) { "$($t.Principal.UserId)|$($t.Actions[0].Execute)|$($t.Actions[0].Arguments)" } else { 'NOT_FOUND' }`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const infoText = new TextDecoder().decode(infoResult.stdout).trim()

        if (infoText === 'NOT_FOUND' || !infoText) {
            consola.warn(`Task not found: ${taskName}`)
            return
        }

        const [taskUser, execute, args] = infoText.split('|')

        if (taskUser === 'SYSTEM' && !admin) {
            consola.error(`Task '${taskName}' is registered as SYSTEM. Run as administrator.`)
            process.exit(1)
        }

        console.log()
        console.log(bold(cyan('=== Task to Remove ===')))
        console.log(
            table(
                ['Field', 'Value'],
                [
                    ['Task name', taskName],
                    ['Run as', taskUser ?? ''],
                    ['Binary', execute ?? ''],
                    ['Arguments', args ?? ''],
                ],
            ),
        )
        console.log()

        const ok = await confirm({
            message: red('Delete this task?'),
            default: false,
            active: 'Delete',
            inactive: 'Cancel',
        })
        if (!ok) {
            console.log(dim('Cancelled.'))
            return
        }

        const result = Bun.spawnSync(
            [
                'powershell',
                '-NoProfile',
                '-Command',
                `Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction Stop`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )

        if (result.exitCode !== 0) {
            const errText = new TextDecoder().decode(result.stderr).trim()
            consola.error(`Failed to remove task:\n${errText}`)
            process.exit(1)
        }

        console.log(green(`✓ Task '${bold(taskName)}' removed.`))
    })

// ─── schedule (container) ──────────────────────────────────────────────────────────────

export const scheduleCmd = app
    .sub('schedule')
    .meta({ description: 'Manage Task Scheduler' })
    .command(registerCmd)
    .command(unregisterCmd)
