import { defineConfig } from 'bumpp'

export default defineConfig({
    release: 'prompt',
    tag: false,
    commit: true,
    push: false,
    all: true,
    execute: 'bun run bump:hook',
    files: ['package.json', 'bekk-core/Cargo.toml'],
})
