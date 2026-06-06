import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: [
            'PapaCheck.Tests/**/*.test.js',
            'PapaCheck.Tests/**/test_*.js',
            'PapaCheck.Server.Node/test/**/*.test.ts',
        ],
    },
});
