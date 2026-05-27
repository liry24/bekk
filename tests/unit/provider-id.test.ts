import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'pathe'

import {
    assertSafeProviderId,
    isSafeProviderId,
    resolveSafeAppListPath,
} from '../../src/lib/apps/provider-id'

describe('provider id validation', () => {
    it('accepts compact provider ids', () => {
        for (const providerId of ['winget', 'scoop', 'custom-provider_1']) {
            expect(isSafeProviderId(providerId)).toBe(true)
            expect(assertSafeProviderId(providerId)).toBe(providerId)
        }
    })

    it('rejects traversal, separators, empty, and control characters', () => {
        for (const providerId of ['../../evil', 'a/b', 'a\\b', '..', '.', '', 'bad\nid']) {
            expect(isSafeProviderId(providerId)).toBe(false)
            expect(() => assertSafeProviderId(providerId)).toThrow()
        }
    })

    it('resolves valid app-list paths under the app-list directory only', () => {
        const dir = mkdtempSync(join(tmpdir(), 'bekk-provider-id-'))
        try {
            expect(resolveSafeAppListPath(dir, 'winget')).toBe(join(dir, 'winget.json'))
            expect(() => resolveSafeAppListPath(dir, '../evil')).toThrow()
            expect(existsSync(join(dir, '..', 'evil.json'))).toBe(false)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
