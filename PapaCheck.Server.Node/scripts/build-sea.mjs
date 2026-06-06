/**
 * SEA (Single Executable Application) 构建脚本
 * 支持 Node.js v22+（v25.5+ 使用 --build-sea，v22-v25.4 使用 postject）
 *
 * 用法: node scripts/build-sea.mjs
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync, unlinkSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const SEA_CONFIG = resolve(ROOT, 'sea-config.json');
const BLOB_PATH = resolve(DIST, 'sea-prep.blob');
const SEA_EXE = resolve(DIST, 'papacheck-server.exe');
const NODE_EXE = process.execPath;

// 检测 Node.js 主版本号
const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
const hasBuildSea = nodeMajor > 25 || (nodeMajor === 25 && parseInt(process.version.slice(1).split('.')[1], 10) >= 5);

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

async function build() {
  console.log('\n=== Step 1: esbuild 打包 TypeScript ===\n');
  if (!existsSync(resolve(ROOT, 'node_modules', '.bin', 'esbuild.cmd'))) {
    console.log('esbuild 未安装，跳过 SEA 构建');
    console.log('请先安装 esbuild: npm install -D esbuild');
    process.exit(1);
  }

  run('npx esbuild src/index.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/bundle.mjs --external:better-sqlite3 --external:@fastify/static --external:@fastify/swagger --external:@fastify/swagger-ui');

  console.log('\n=== Step 2: 复制 TTS 桥接脚本 ===\n');
  const scriptsDest = resolve(DIST, 'scripts');
  if (!existsSync(scriptsDest)) {
    execSync(`mkdir "${scriptsDest}"`, { stdio: 'inherit' });
  }
  copyFileSync(
    resolve(ROOT, 'scripts', 'tts_bridge.py'),
    resolve(scriptsDest, 'tts_bridge.py')
  );

  console.log('\n=== Step 3: 创建 SEA 配置文件 ===\n');
  const seaConfig = JSON.stringify({
    main: resolve(DIST, 'bundle.mjs'),
    output: BLOB_PATH,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: {
      ttsBridge: resolve(ROOT, 'scripts', 'tts_bridge.py'),
    },
  }, null, 2);
  writeFileSync(SEA_CONFIG, seaConfig);

  console.log('\n=== Step 4: 生成 SEA Blob ===\n');
  run(`node --experimental-sea-config "${SEA_CONFIG}"`);

  console.log('\n=== Step 5: 复制 Node.js 可执行文件 ===\n');
  copyFileSync(NODE_EXE, SEA_EXE);

  console.log('\n=== Step 6: 移除 EXE 签名（Windows） ===\n');
  try {
    run(`signtool remove /s "${SEA_EXE}"`);
  } catch {
    console.log('  signtool 不可用或移除签名失败（非致命）');
  }

  console.log(`\n=== Step 7: 注入 SEA Blob（${hasBuildSea ? '--build-sea' : 'postject'}） ===\n`);
  if (hasBuildSea) {
    run(`node --build-sea "${SEA_EXE}" "${BLOB_PATH}"`);
  } else {
    run(`npx postject "${SEA_EXE}" NODE_SEA_BLOB "${BLOB_PATH}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);
  }

  console.log('\n=== Step 8: 清理临时文件 ===\n');
  if (existsSync(BLOB_PATH)) unlinkSync(BLOB_PATH);
  if (existsSync(SEA_CONFIG)) unlinkSync(SEA_CONFIG);

  console.log('\n=== 构建完成! ===\n');
  console.log(`  输出: ${SEA_EXE}`);
  console.log(`  大小: ${(existsSync(SEA_EXE) ? statSync(SEA_EXE).size / 1024 / 1024 : 0).toFixed(1)} MB`);
}

build().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
