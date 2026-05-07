import { defineConfig } from 'bumpp'

export default defineConfig({
    release: 'prompt',
    tag: true,
    commit: true,
    push: false,
    execute: 'bun run bump:hook',
    files: ['package.json', 'bekk-core/Cargo.toml'],
})
