#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 自动加载 .env 文件（如果存在），避免每次手动设置环境变量
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { Command } from 'commander';
import { startServer } from './console-server.js';
import { buildApk } from './lib/build-apk.js';
import { cloudPublish } from './lib/cloud-publish.js';
import { sitePublish } from './lib/site-publish.js';
import { Executor } from './lib/executor.js';

const program = new Command();

program
  .name('release')
  .description('PapaCheck 发布工具')
  .version('1.0.0');

program
  .command('serve')
  .description('启动 Web 控制台')
  .option('-p, --port <port>', '端口号', '3456')
  .action(async (options) => {
    await startServer(parseInt(options.port));
  });

program
  .command('build-apk')
  .description('构建 Android APK')
  .option('-v, --ver <ver>', '指定版本号 (X.Y.Z)')
  .option('--bump <level>', '递增版本号 (patch|minor|major)，默认不递增')
  .option('--no-bump', '不递增版本号')
  .option('-p, --publish', '构建后自动上传到 CloudBase 并更新版本号')
  .action(async (options) => {
    const executor = new Executor();
    const success = await buildApk(executor, {
      ver: options.ver, bump: options.bump, noBump: options.noBump, publish: options.publish,
    });
    process.exit(success ? 0 : 1);
  });

program
  .command('cloud')
  .description('同步到云端')
  .action(async () => {
    const executor = new Executor();
    const success = await cloudPublish(executor);
    process.exit(success ? 0 : 1);
  });

program
  .command('site')
  .description('部署 PapaCheck.Site')
  .action(async () => {
    const executor = new Executor();
    const success = await sitePublish(executor);
    process.exit(success ? 0 : 1);
  });

program.parse(process.argv);
