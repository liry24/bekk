import { red } from '@crustjs/style'
import consola from 'consola'

import type { CoreResult } from '#bekk-core'
import { resolveRepoPassword } from '#lib/secrets'

import { configStore } from '../store'

export const unwrapCoreResult = <T>(result: CoreResult<T>): T => {
    if (result.status === 'error') throw new Error(result.message)
    if (result.status === 'ok' && 'data' in result && result.data) return result.data
    if (result.status === 'ok') return undefined as T
    throw new Error('Unexpected bekk-core response')
}

export const withRepoAuth = async <T>(
    fn: (cfg: Awaited<ReturnType<typeof configStore.read>>, password: string) => Promise<T>,
): Promise<T> => {
    const cfg = await configStore.read()

    if (!cfg.repoPath) {
        consola.error(red('Backup destination is not configured. Run `bekk init` first.'))
        throw new Error('Repository not configured')
    }

    const password = await resolveRepoPassword()
    if (!password) {
        consola.error(red('Backup password is not stored. Run `bekk config`.'))
        throw new Error('Password not stored')
    }

    return fn(cfg, password)
}
