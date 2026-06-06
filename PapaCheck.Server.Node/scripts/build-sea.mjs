/**
 * 单 EXE 构建脚本
 * 1. esbuild 打包 TypeScript 为 CJS bundle
 * 2. pkg 打包为单 EXE（处理 better-sqlite3 原生插件）
 *
 * 用法: node scripts/build-sea.mjs
 */
import { execSync } from 'child_process';
import { existsSync, copyFileSync, writeFileSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
var __dirname = dirname(fileURLToPath(import.meta.url));
var ROOT = resolve(__dirname, '..');
var DIST = resolve(ROOT, 'dist');
var OUTPUT = resolve(DIST, 'papacheck-server.exe');
function run(cmd) {
  console.log(cmd);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}
async function build() {
  console.log('\n=== Step 1: 复制 TTS 桥接脚本 ===\n');
  var dest = resolve(DIST, 'scripts');
  mkdirSync(dest, { recursive: true });
  copyFileSync(resolve(ROOT, 'scripts', 'tts_bridge.py'), resolve(dest, 'tts_bridge.py'));
  console.log('\n=== Step 2: esbuild 打包为 CJS bundle ===\n');
  run('npx esbuild src/index.ts --bundle --platform=node --target=node18 --format=cjs --outfile=dist/bundle.cjs --external:better-sqlite3');
  console.log('\n=== Step 3: 复制 swagger-ui 静态资源 ===\n');
  var swaggerStatic = resolve(ROOT, 'node_modules', '@fastify', 'swagger-ui', 'static');
  var swaggerDst = resolve(DIST, 'static');
  if (existsSync(swaggerStatic)) { mkdirSync(swaggerDst, { recursive: true }); execSync('xcopy "' + swaggerStatic + '" "' + swaggerDst + '" /E /I /Y /Q', { stdio: 'ignore' }); }

  console.log('\n=== Step 4: 重编 better-sqlite3 为 Node 18 目标 ===\n');
  run('cd node_modules/better-sqlite3 && npx node-gyp rebuild --target=18.5.0 --arch=x64 --dist-url=https://nodejs.org/dist');
  var nodeAddonSrc = resolve(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  var nodeAddonDst = resolve(DIST, 'better_sqlite3.node');
  if (existsSync(nodeAddonSrc)) { copyFileSync(nodeAddonSrc, nodeAddonDst); }
  var testExtSrc = resolve(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'test_extension.node');
  var testExtDst = resolve(DIST, 'test_extension.node');
  if (existsSync(testExtSrc)) { copyFileSync(testExtSrc, testExtDst); }

  console.log('\n=== Step 5: 创建临时 package.json ===\n');
  var pkgJson = { name: 'papacheck-server', version: '1.2.0', bin: 'bundle.cjs', dependencies: { 'better-sqlite3': '*', '@fastify/static': '*', '@fastify/swagger': '*', '@fastify/swagger-ui': '*' }, pkg: { assets: ['dist/scripts/**/*', '../node_modules/better-sqlite3/**/*', '../node_modules/@fastify/swagger-ui/static/**/*'], targets: ['node18-win-x64'] } };
  writeFileSync(resolve(DIST, 'package.json'), JSON.stringify(pkgJson, null, 2));
  console.log('\n=== Step 6: pkg 打包 EXE ===\n');
  try { execSync('rmdir /S /Q "' + resolve(DIST, 'node_modules') + '"', { stdio: 'ignore' }); } catch(e) {}
  run('npx pkg dist/package.json --targets node18-win-x64 --output "' + OUTPUT + '"');
  console.log('\n=== Step 7: 验证 EXE ===\n');
  if (existsSync(OUTPUT)) {
    console.log('  输出: ' + OUTPUT);
    console.log('  大小: ' + (statSync(OUTPUT).size / 1024 / 1024).toFixed(1) + ' MB');
  } else {
    console.error('错误: EXE 文件未生成');
    process.exit(1);
  }
  try { unlinkSync(resolve(DIST, 'package.json')); } catch(e) {}
  console.log('\n=== 构建完成! ===\n');
}
build().catch(function(err) { console.error('构建失败:', err); process.exit(1); });
