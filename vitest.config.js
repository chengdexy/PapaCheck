import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 自动加载 .env.test（如果存在），避免每次都手动设置 DATABASE_URL
const envTestPath = resolve(__dirname, 'PapaCheck.Server', '.env.test');
if (existsSync(envTestPath)) {
  const lines = readFileSync(envTestPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      // 不覆盖已有的环境变量（如 CI 中手动设置的 DATABASE_URL）
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

export default defineConfig({
  test: {
    root: __dirname,
    globals: true,
    include: [
      'PapaCheck.Tests/**/*.test.js',
      'PapaCheck.Server/test/**/*.test.ts',
      'PapaCheck.Site/src/**/*.test.tsx',
      'PapaCheck.Web/js/__tests__/**/*.test.js',
    ],
  },
});
