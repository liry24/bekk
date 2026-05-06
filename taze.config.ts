import { defineConfig } from 'taze'

export default defineConfig({
    force: true,
    write: true,
    install: false,
    interactive: true,
    includeLocked: true,
    ignorePaths: ['**/node_modules/**'],
    ignoreOtherWorkspaces: true,
    depFields: {
        overrides: false,
    },
})
