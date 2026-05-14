import { bekkCore } from '#bekk-core'
import { unwrapCoreResult } from '#lib/core-helpers'
import { select } from '#lib/ui'
import type { PasswordOptions } from '#lib/ui'

import { configStore } from '../store'

// NOTE: Bun.secrets is an experimental API (requires Bun >= 1.3.x).
// It stores credentials using the OS native credential manager:
//   Windows  → Windows Credential Manager
//   macOS    → Keychain
//   Linux    → libsecret (GNOME Keyring, KWallet, etc.)

const SERVICE = 'bekk'
const REPO_PASSWORD_KEY = 'repo-password'

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+'

export const generatePassword = (length = 32) => {
    const charsLength = PASSWORD_CHARS.length
    // Use rejection sampling to avoid modulo bias.
    // The largest multiple of charsLength that fits in a byte (0–255).
    const limit = 256 - (256 % charsLength)
    let result = ''
    while (result.length < length) {
        const bytes = crypto.getRandomValues(new Uint8Array((length - result.length) * 2))
        for (let i = 0; i < bytes.length && result.length < length; i++) {
            if (bytes[i]! < limit) result += PASSWORD_CHARS.charAt(bytes[i]! % charsLength)
        }
    }
    return result
}

/**
 * Prompt for a backup password. Returns auto-generated password if user leaves it blank.
 */
export const promptPassword = async (
    password: (options: PasswordOptions) => Promise<string>,
): Promise<{ password: string; wasGenerated: boolean }> => {
    const entered = await password({
        message: 'Backup password  (press Enter to auto-generate)',
    })

    if (entered.trim()) {
        await password({
            message: 'Confirm backup password',
            validate: (v) => (v === entered ? true : 'Passwords do not match'),
        })
        return { password: entered, wasGenerated: false }
    }

    return { password: generatePassword(), wasGenerated: true }
}

/**
 * Resolve the repo password from the OS credential manager or the config file.
 * If both exist but differ, prompts the user to choose which one to use.
 * Returns `undefined` if no password is found.
 */
export const resolveRepoPassword = async (): Promise<string | undefined> => {
    const osPassword = await Bun.secrets.get({ service: SERVICE, name: REPO_PASSWORD_KEY })
    const { savedPassword } = await configStore.read()

    if (!osPassword && !savedPassword) return
    else if (osPassword && savedPassword && osPassword !== savedPassword) {
        const choice = await select({
            message: 'Which one do you want to use as the repository password?',
            choices: [
                { label: 'OS credential manager', value: 'os' },
                { label: 'Config file', value: 'config' },
            ],
        })

        return choice === 'os' ? osPassword : savedPassword
    } else return osPassword || savedPassword
}

export const setRepoPassword = async (value: string, options: { saveToConfig?: boolean } = {}) => {
    const { saveToConfig = false } = options
    await Bun.secrets.set({ service: SERVICE, name: REPO_PASSWORD_KEY, value })
    if (saveToConfig) await configStore.patch({ savedPassword: value })
}

/**
 * Re-key the rustic repository with a new password, then update the OS credential manager.
 * Throws if the repository re-keying fails (credential store is left unchanged).
 */
export const changeRepoPassword = async (options: {
    repo: string
    oldPassword: string
    newPassword: string
    saveToConfig?: boolean
}) => {
    const { repo, oldPassword, newPassword, saveToConfig = false } = options
    unwrapCoreResult(await bekkCore.changePassword(repo, oldPassword, newPassword))
    await setRepoPassword(newPassword, { saveToConfig })
}

// ─── S3 Secret Access Key ─────────────────────────────────────────────────────

const S3_SERVICE = 'bekk-s3'

export const getS3SecretAccessKey = async (destinationName: string) =>
    Bun.secrets.get({ service: S3_SERVICE, name: destinationName })

export const setS3SecretAccessKey = async (destinationName: string, value: string) =>
    await Bun.secrets.set({ service: S3_SERVICE, name: destinationName, value })

export const deleteS3SecretAccessKey = async (destinationName: string) =>
    Bun.secrets.delete({ service: S3_SERVICE, name: destinationName })

// ─── GitHub Token ─────────────────────────────────────────────────────────────

const GITHUB_SERVICE = 'bekk-github'
const GITHUB_TOKEN_KEY = 'token'

export const getGitHubToken = async (): Promise<string | undefined> => {
    const value = await Bun.secrets.get({ service: GITHUB_SERVICE, name: GITHUB_TOKEN_KEY })
    return value ?? undefined
}

export const setGitHubToken = async (value: string) =>
    Bun.secrets.set({ service: GITHUB_SERVICE, name: GITHUB_TOKEN_KEY, value })

export const deleteGitHubToken = async () =>
    Bun.secrets.delete({ service: GITHUB_SERVICE, name: GITHUB_TOKEN_KEY })
