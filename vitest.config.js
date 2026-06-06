import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        root: __dirname,
        globals: true,
        include: [
            'PapaCheck.Tests/**/*.test.js',
            'PapaCheck.Server.Node/test/**/*.test.ts',
            'PapaCheck.Web/js/__tests__/**/*.test.js',
        ],
    },
});
