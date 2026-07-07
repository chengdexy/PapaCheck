import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: __dirname,
    environment: 'jsdom',
    include: ['__tests__/**/*.test.js'],
  },
});
