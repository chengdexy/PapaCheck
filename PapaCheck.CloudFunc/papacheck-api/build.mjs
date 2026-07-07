import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 打包所有入口文件为 CommonJS
await build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/index.js',
  // 在 CJS 输出中 polyfill import.meta.url
  // banner 定义变量（module.filename 等同于 CJS 原生 __filename，未被 esbuild 遮蔽）
  // define 将 import.meta.url 替换为该实体名（define 值必须是实体名或字面量）
  banner: {
    js: 'const __import_meta_url = require("url").pathToFileURL(module.filename).href;',
  },
  define: {
    'import.meta.url': '__import_meta_url',
  },
  // 不打包 node_modules 中的依赖（运行时安装）
  external: [
    '@fastify/cookie',
    '@fastify/rate-limit',
    'bcryptjs',
    'fastify',
    'jsonwebtoken',
    'minimist',
    'pg',
    // pg 的原生依赖
    'pg-native',
    'pg-cloudflare',
    'pg-connection-string',
    'pg-pool',
    'pg-types',
    'pg-int8',
    'pg-protocol',
    'pg-utils',
    'pg-numeric',
    'pg-isodate',
    'postgres-array',
    'postgres-bytea',
    'postgres-date',
    'postgres-interval',
    'postgres-range',
  ],
  // 保持源码中的 import 路径
  packages: 'external',
});

// 生成 dist/package.json（不带 type:module，只含运行时依赖）
// cloudbaserc.json 的 source 为 "dist"，CloudBase 会上传 dist 目录并按此 package.json 安装依赖
const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
);
const distPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: rootPkg.description,
  main: 'index.js',
  dependencies: rootPkg.dependencies,
};
mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
writeFileSync(
  resolve(__dirname, 'dist/package.json'),
  JSON.stringify(distPkg, null, 2) + '\n',
);

console.log('✓ Build complete: dist/index.js (CommonJS)');
console.log('✓ Generated: dist/package.json (CommonJS, runtime deps only)');
