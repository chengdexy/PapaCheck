/**
 * 单 EXE 构建脚本
 * 1. esbuild 打包 TypeScript 为 CJS bundle
 * 2. pkg 打包为单 EXE（处理 better-sqlite3 原生插件）
 *
 * 用法: node scripts/build-sea.mjs
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PKG_OUTPUT = resolve(DIST, 'papacheck-server.exe');

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

async function build() {
  console.log('\n=== Step 1: 复制 TTS 桥接脚本 ===\n');
  const scriptsDest = resolve(DIST, 'scripts');
  mkdirSync(scriptsDest, { recursive: true });
  copyFileSync(
    resolve(ROOT, 'scripts', 'tts_bridge.py'),
    resolve(scriptsDest, 'tts_bridge.py')
  );

  console.log('\n=== Step 2: esbuild 打包为 CJS bundle ===\n');
  run('npx esbuild src/index.ts --bundle --platform=node --target=node18 --format=cjs --outfile=dist/bundle.cjs --external:better-sqlite3');

  console.log('\n=== Step 3: 创建临时 package.json 用于 pkg（CJS） ===\n');
  const pkgJson = {
    name: 'papacheck-server',
    version: '1.2.0',
    bin: 'bundle.cjs',
    dependencies: {
      'better-sqlite3': '*',
      '@fastify/static': '*',
      '@fastify/swagger': '*',
      '@fastify/swagger-ui': '*',
    },
    pkg: {
      assets: [
        'dist/scripts/**/*',
        'node_modules/better-sqlite3/**/*',
      ],
      targets: ['node18-win-x64'],
    },
  };
  writeFileSync(resolve(DIST, 'package.json'), JSON.stringify(pkgJson, null, 2));

  console.log('\n=== Step 4: pkg 打包 EXE ===\n');
  run(`npx pkg dist/package.json --targets node18-win-x64 --output "${PKG_OUTPUT}"`);

  console.log('\n=== Step 5: 验证 EXE ===\n');
  if (existsSync(PKG_OUTPUT)) {
    const sizeMB = (statSync(PKG_OUTPUT).size / 1024 / 1024).toFixed(1);
    console.log(`  输出: ${PKG_OUTPUT}`);
    console.log(`  大小: ${sizeMB} MB`);
  } else {
    console.error('错误: EXE 文件未生成');
    process.exit(1);
  }

  // 清理临时文件
  try {
    if (existsSync(resolve(DIST, 'package.json'))) {
      execSync(`del "${resolve(DIST, 'package.json')}"`);
    }
  } catch {}

  console.log('\n=== 构建完成! ===\n');
}

build().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
