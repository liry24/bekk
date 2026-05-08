import { app } from './app'
import { appsCmd } from './commands/apps'
import { backupCmd } from './commands/backup'
import { cleanCmd } from './commands/clean'
import { configCmd } from './commands/config'
import { daemonCmd } from './commands/daemon'
import { gistCmd } from './commands/gist'
import { initCmd } from './commands/init'
import { pullCmd } from './commands/pull'
import { pushCmd } from './commands/push'
import { restoreCmd } from './commands/restore'
import { scheduleCmd } from './commands/schedule'
import { snapshotsCmd } from './commands/snapshots'

await app
    .command(backupCmd)
    .command(restoreCmd)
    .command(snapshotsCmd)
    .command(appsCmd)
    .command(configCmd)
    .command(pushCmd)
    .command(pullCmd)
    .command(gistCmd)
    .command(scheduleCmd)
    .command(daemonCmd)
    .command(cleanCmd)
    .command(initCmd)
    .execute()
