import { app } from './app'
import { backupCmd } from './commands/backup'
import { configCmd } from './commands/config'
import { gistCmd } from './commands/gist'
import { initCmd } from './commands/init'
import { loginCmd } from './commands/login'
import { logoutCmd } from './commands/logout'
import { scheduleCmd } from './commands/schedule'

await app
    .command(initCmd)
    .command(backupCmd)
    .command(configCmd)
    .command(loginCmd)
    .command(logoutCmd)
    .command(gistCmd)
    .command(scheduleCmd)
    .execute()
