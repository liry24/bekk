import { isAbsolute, relative, resolve } from 'pathe'

const SAFE_PROVIDER_ID_RE = /^[a-z0-9_-]+$/

export const isSafeProviderId = (providerId: string): boolean => {
    if (!providerId || providerId === '.' || providerId === '..') return false
    if (providerId.includes('/') || providerId.includes('\\')) return false
    for (let i = 0; i < providerId.length; i++) {
        const code = providerId.charCodeAt(i)
        if (code < 32 || code === 127) return false
    }
    return SAFE_PROVIDER_ID_RE.test(providerId)
}

export const assertSafeProviderId = (providerId: string): string => {
    if (!isSafeProviderId(providerId)) {
        throw new Error(`Invalid provider id: ${JSON.stringify(providerId)}`)
    }
    return providerId
}

export const resolveSafeAppListPath = (appListsDir: string, providerId: string): string => {
    const safeProviderId = assertSafeProviderId(providerId)
    const baseDir = resolve(appListsDir)
    const target = resolve(baseDir, `${safeProviderId}.json`)
    const rel = relative(baseDir, target)

    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`App list path escapes app-list directory: ${providerId}`)
    }

    return target
}
