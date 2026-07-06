import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { Executor, type StepDef } from './executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const NODE_DIR = join(ROOT, 'PapaCheck.Server');
const ANDROID_DIR = join(ROOT, 'PapaCheck.Android');
const APK_ARCHIVE_DIR = join(ANDROID_DIR, 'apk');
const APK_BUILD_OUTPUT = join(ANDROID_DIR, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');

const SSH_OPTS = ['-o', 'StrictHostKeyChecking=accept-new'];

const CLOUDBASE_ENV = 'child-teacher-parent-d9aef9d2208';

function requireEnv(): { ip: string; user: string } {
  const ip = process.env.PAPACHECK_CLOUD_IP;
  const user = process.env.PAPACHECK_SSH_USER;
  if (!ip) throw new Error('请设置环境变量 PAPACHECK_CLOUD_IP（服务器地址或域名）');
  if (!user) throw new Error('请设置环境变量 PAPACHECK_SSH_USER（SSH 登录用户名）');
  return { ip, user };
}

/** 从 apk 目录找到最新 APK，返回 { path, version } */
function findLatestApk(): { path: string; version: string } | null {
  let apkFile: string | null = null;
  if (existsSync(APK_ARCHIVE_DIR)) {
    const files = readdirSync(APK_ARCHIVE_DIR)
      .filter(f => f.startsWith('PapaCheck-') && f.endsWith('.apk'))
      .sort().reverse();
    if (files.length > 0) apkFile = join(APK_ARCHIVE_DIR, files[0]);
  }
  if (!apkFile && existsSync(APK_BUILD_OUTPUT)) {
    apkFile = APK_BUILD_OUTPUT;
  }
  if (!apkFile) return null;
  const name = basename(apkFile);
  const m = name.match(/PapaCheck-(.+)\.apk/);
  const version = m ? m[1] : '0.0.0';
  return { path: apkFile, version };
}

export async function cloudPublish(executor: Executor): Promise<boolean> {
  const { ip: CLOUD_SERVER_IP, user: CLOUD_SERVER_USER } = requireEnv();
  const steps: StepDef[] = [];
  let idx = 1;

  // 重置测试库 schema，确保 PG 测试能通过
  steps.push({
    id: String(idx++), desc: '重置测试数据库 schema',
    cmd: 'npx tsx lib/reset-test-db.ts',
    cwd: join(ROOT, 'PapaCheck.Release'), shell: true, timeout: 30,
  });

  // 运行全量测试（过滤输出，仅保留失败信息和摘要）
  steps.push({
    id: String(idx++), desc: '运行全量测试',
    cmd: 'npx vitest run 2>&1',
    cwd: ROOT, shell: true, timeout: 180,
  });

  // 编译 TypeScript
  steps.push({
    id: String(idx++), desc: '编译 TypeScript',
    cmd: 'npm run build', cwd: NODE_DIR, shell: true, timeout: 180,
  });

  // 上传 APK 到 CloudBase 云存储
  const apk = findLatestApk();
  if (apk) {
    steps.push({
      id: String(idx++), desc: `上传 APK 到 CloudBase (PapaCheck-${apk.version}.apk)`,
      cmd: ['tcb', 'storage', 'objects', 'upload',
        apk.path, `PapaCheck-${apk.version}.apk`,
        '-b', 'dist',
        '-e', CLOUDBASE_ENV,
        '--content-type', 'application/vnd.android.package-archive',
        '--use-put',
        '--json'],
      timeout: 120,
    });

    // 更新 ECS 上的 PAPACHECK_CLIENT_VERSION 环境变量
    steps.push({
      id: String(idx++), desc: `更新 ECS 环境变量 PAPACHECK_CLIENT_VERSION=${apk.version}`,
      cmd: ['ssh', ...SSH_OPTS, `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}`,
        `grep -q '^Environment=PAPACHECK_CLIENT_VERSION=' /etc/systemd/system/papacheck.service && sed -i 's/^Environment=PAPACHECK_CLIENT_VERSION=.*/Environment=PAPACHECK_CLIENT_VERSION='\\''${apk.version}'\\''/' /etc/systemd/system/papacheck.service || sed -i '/^Environment=NODE_ENV=/a Environment=PAPACHECK_CLIENT_VERSION='\\''${apk.version}'\\''' /etc/systemd/system/papacheck.service`],
      timeout: 30,
    });
  }

  // 打包代码
  const tarExcludes = [
    '--exclude=node_modules', '--exclude=test',
    '--exclude=PapaCheck.Android', '--exclude=PapaCheck.Tests',
    '--exclude=PapaCheck.Site', '--exclude=PapaCheck.WeChat',
    '--exclude=PapaCheck.Memo', '--exclude=PapaCheck.Release',
    '--exclude=.trae', '--exclude=*.md', '--exclude=.publish.tar.gz',
    '--exclude=nginx.conf', '--exclude=papacheck.service',
    '--exclude=docker-compose.yml', '--exclude=.dockerignore',
  ];
  const tarPath = join(ROOT, '.publish.tar.gz');
  steps.push({
    id: String(idx++), desc: '打包代码',
    cmd: ['tar', ...tarExcludes, '-czf', tarPath, 'PapaCheck.Server', 'PapaCheck.Web'],
    cwd: ROOT, timeout: 120,
  });

  // 上传代码到服务器
  steps.push({
    id: String(idx++), desc: '上传代码到服务器',
    cmd: ['scp', ...SSH_OPTS, tarPath, `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}:/opt/`],
    timeout: 120,
  });

  // 远程安装依赖并重启
  const remoteCmd = 'mkdir -p /opt/papacheck && '
    + 'cd /opt && tar xzf .publish.tar.gz -C /opt/papacheck && '
    + 'rm -f .publish.tar.gz && '
    + 'cd /opt/papacheck/PapaCheck.Server && '
    + 'npm ci --omit=dev --ignore-scripts && '
    + 'systemctl daemon-reload && '
    + 'systemctl restart papacheck';
  steps.push({
    id: String(idx++), desc: '远程安装依赖并重启',
    cmd: ['ssh', ...SSH_OPTS, `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}`, remoteCmd],
    timeout: 300,
  });

  // 清理之前可能残留的 tar 文件
  try { unlinkSync(tarPath); } catch {}

  const success = await executor.runAndReport('云同步', steps);

  // 清理本次 tar 文件
  try { unlinkSync(tarPath); } catch {}

  return success;
}
