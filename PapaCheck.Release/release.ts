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
import { deployCloudFunction, updateApkVersion } from './lib/cloud-publish.js';
import { publishSite, publishWebApp } from './lib/site-publish.js';
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
  .command('fn')
  .description('部署云函数到 CloudBase (tcb fn deploy)')
  .action(async () => {
    try {
      await deployCloudFunction();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });

program
  .command('site')
  .description('部署 PapaCheck.Site 到 CloudBase Hosting')
  .action(async () => {
    try {
      await publishSite();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });

program
  .command('web')
  .description('部署 PapaCheck.Web 到 CloudBase Hosting')
  .action(async () => {
    try {
      await publishWebApp();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });

program
  .command('all')
  .description('部署全部（云函数 + Site + Web）')
  .action(async () => {
    try {
      await deployCloudFunction();
      await publishSite();
      await publishWebApp();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });

program
  .command('update-version <version>')
  .description('更新云函数环境变量 APK_VERSION')
  .action(async (version: string) => {
    try {
      await updateApkVersion(version);
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });

program.parse(process.argv);
