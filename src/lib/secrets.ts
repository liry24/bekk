import { select } from '@crustjs/prompts'
import type { password as passwordPrompt } from '@crustjs/prompts'

import { bekkCore } from '#bekk-core'

import { configStore } from '../store'

// NOTE: Bun.secrets is an experimental API (requires Bun >= 1.3.x).
// It stores credentials using the OS native credential manager:
//   Windows  → Windows Credential Manager
//   macOS    → Keychain
//   Linux    → libsecret (GNOME Keyring, KWallet, etc.)

const SERVICE = 'bekk'
const REPO_PASSWORD_KEY = 'repo-password'

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+'

export const generatePassword = (length = 32) => {
    const charsLength = PASSWORD_CHARS.length
    const maxValid = 256 - (256 % charsLength)
    const result: string[] = []
    while (result.length < length) {
        const byte = new Uint8Array(1)
        crypto.getRandomValues(byte)
        const b = byte[0]!
        if (b < maxValid) {
            result.push(PASSWORD_CHARS.charAt(b % charsLength))
        }
    }
    return result.join('')
}

/**
 * Prompt for a backup password. Returns auto-generated password if user leaves it blank.
 */
export const promptPassword = async (
    password: typeof passwordPrompt,
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
    const result = await bekkCore.changePassword(repo, oldPassword, newPassword)
    if (result.status === 'error') throw new Error(result.message)
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
