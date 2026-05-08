import { bekkCore } from '#bekk-core'

// NOTE: Bun.secrets is an experimental API (requires Bun >= 1.3.x).
// It stores credentials using the OS native credential manager:
//   Windows  → Windows Credential Manager
//   macOS    → Keychain
//   Linux    → libsecret (GNOME Keyring, KWallet, etc.)

const SERVICE = 'bekk'
const REPO_PASSWORD_KEY = 'repo-password'

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+'

export const generatePassword = (length = 32) => {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('')
}

export const getRepoPassword = async () =>
    Bun.secrets.get({ service: SERVICE, name: REPO_PASSWORD_KEY })

/**
 * Resolve the repo password from (in priority order):
 * 1. BEKK_REPO_PASSWORD environment variable
 * 2. OS credential manager
 * 3. savedPassword field in config store
 */
export const resolveRepoPassword = async (): Promise<string | undefined> => {
    if (Bun.env.BEKK_REPO_PASSWORD) return Bun.env.BEKK_REPO_PASSWORD
    const osPassword = await Bun.secrets.get({ service: SERVICE, name: REPO_PASSWORD_KEY })
    if (osPassword) return osPassword
    const { configStore } = await import('../store')
    const cfg = await configStore.read()
    return cfg.savedPassword || undefined
}

export const setRepoPassword = async (value: string) => {
    await Bun.secrets.set({ service: SERVICE, name: REPO_PASSWORD_KEY, value })
}

/**
 * Re-key the rustic repository with a new password, then update the OS credential manager.
 * Throws if the repository re-keying fails (credential store is left unchanged).
 */
export const changeRepoPassword = async (
    repo: string,
    oldPassword: string,
    newPassword: string,
) => {
    const result = await bekkCore.changePassword(repo, oldPassword, newPassword)
    if (result.status === 'error') throw new Error(result.message)
    await setRepoPassword(newPassword)
}

export const deleteRepoPassword = async () =>
    Bun.secrets.delete({ service: SERVICE, name: REPO_PASSWORD_KEY })

// ─── S3 Secret Access Key ─────────────────────────────────────────────────────

const S3_SERVICE = 'bekk-s3'

export const getS3SecretAccessKey = async (destinationName: string) =>
    Bun.secrets.get({ service: S3_SERVICE, name: destinationName })

export const setS3SecretAccessKey = async (destinationName: string, value: string) =>
    await Bun.secrets.set({ service: S3_SERVICE, name: destinationName, value })

export const deleteS3SecretAccessKey = async (destinationName: string) =>
    Bun.secrets.delete({ service: S3_SERVICE, name: destinationName })
