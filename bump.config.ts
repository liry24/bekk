import { defineConfig } from 'bumpp'

export default defineConfig({
    release: 'prompt',
    tag: true,
    commit: false,
    push: false,
    files: ['package.json', 'bekk-core/Cargo.toml'],
})
