import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { join } from 'pathe'

import { writePulledAppLists } from '../../src/commands/pull'
import { parseGistAppListFileName } from '../../src/lib/sync/backends/gist'

describe('sync app-list safety', () => {
    it('writes valid pulled app lists only under the app-list directory', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bekk-sync-pull-'))
        try {
            const count = await writePulledAppLists(dir, {
                winget: [{ name: 'Git', version: '1.0.0' }],
                scoop: null,
            })

            expect(count).toBe(1)
            expect(JSON.parse(readFileSync(join(dir, 'winget.json'), 'utf8'))).toEqual([
                { name: 'Git', version: '1.0.0' },
            ])
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('rejects pulled provider ids that could escape the app-list directory', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bekk-sync-pull-'))
        try {
            for (const providerId of ['../../evil', 'a/b', '..', '', 'bad\nid']) {
                await expect(
                    writePulledAppLists(dir, {
                        [providerId]: [{ name: 'Bad', version: '0.0.0' }],
                    }),
                ).rejects.toThrow()
            }
            expect(existsSync(join(dir, '..', 'evil.json'))).toBe(false)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('parses only safe Gist app-list filenames', () => {
        expect(parseGistAppListFileName('apps_winget.json')).toBe('winget')
        expect(parseGistAppListFileName('apps_custom-provider_1.json')).toBe('custom-provider_1')

        for (const filename of [
            'apps_../../evil.json',
            'apps_a/b.json',
            'apps_..json',
            'apps_.json',
            'apps_bad\nid.json',
            'not_apps_winget.json',
        ]) {
            expect(parseGistAppListFileName(filename)).toBeNull()
        }
    })
})
