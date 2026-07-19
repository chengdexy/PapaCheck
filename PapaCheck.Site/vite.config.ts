import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

/// <reference types="vitest" />
import { copyFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * 把 admin 入口的 `/assets/...` 路径重写成 `/papacheck/admin/assets/...`，
 * 这样 admin 部署到 `/papacheck/admin/` 时
 * 资源引用正确指向 `/papacheck/admin/assets/...`。
 */
function adminBaseRewrite(): Plugin {
  return {
    name: 'admin-base-rewrite',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.filename) return html;
        const isAdmin = ctx.filename.replace(/\\/g, '/').includes('/admin/index.html')
          || ctx.filename.endsWith('admin.html');
        if (!isAdmin) return html;
        return html
          .replace(/(href|src)="\/assets\//g, '$1="/papacheck/admin/assets/')
          .replace(/url\((\/assets\/[^)]+)\)/g, 'url(/papacheck/admin$1)');
      },
    },
  };
}

/**
 * 把 admin 用到的 chunks 复制到 dist/admin/assets/。
 * - admin-*  → 只 admin 用，复制到 admin/assets/
 * - refresh- → 共享 chunk，复制到 admin/assets/（landing 那份保留）
 */
function copyAdminAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'copy-admin-assets',
    apply: 'build',
    async closeBundle() {
      const srcDir = join(outDir, 'assets');
      const destDir = join(outDir, 'admin', 'assets');
      await mkdir(destDir, { recursive: true });
      const files = await readdir(srcDir);
      for (const f of files) {
        if (f.startsWith('admin-') || f.startsWith('refresh-')) {
          await copyFile(join(srcDir, f), join(destDir, f));
        }
      }
    },
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
  };
}

const viteConfig = {
  base: '/papacheck/',
  plugins: [react(), tailwindcss(), adminBaseRewrite(), copyAdminAssets()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        admin: `${root}admin/index.html`,
      },
    },
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  },
};

export default defineConfig(viteConfig);
