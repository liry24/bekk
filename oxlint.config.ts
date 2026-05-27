import { defineConfig } from 'oxlint'

export default defineConfig({
    plugins: ['import'],
    options: {
        typeAware: true,
    },
})
