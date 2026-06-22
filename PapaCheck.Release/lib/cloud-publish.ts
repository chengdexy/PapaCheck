import { join, dirname } from 'path';
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

function requireEnv(): { ip: string; user: string } {
  // 在函数内部读取 env，方便测试中通过 beforeAll 设置
  const ip = process.env.PAPACHECK_CLOUD_IP;
  const user = process.env.PAPACHECK_SSH_USER;
  if (!ip) throw new Error('请设置环境变量 PAPACHECK_CLOUD_IP（服务器地址或域名）');
  if (!user) throw new Error('请设置环境变量 PAPACHECK_SSH_USER（SSH 登录用户名）');
  return { ip, user };
}

export async function cloudPublish(executor: Executor): Promise<boolean> {
  const { ip: CLOUD_SERVER_IP, user: CLOUD_SERVER_USER } = requireEnv();
  const steps: StepDef[] = [];

  steps.push({
    id: '1', desc: '运行全量测试',
    cmd: 'npm test', cwd: ROOT, shell: true, timeout: 180,
  });

  steps.push({
    id: '2', desc: '编译 TypeScript',
    cmd: 'npm run build', cwd: NODE_DIR, shell: true, timeout: 180,
  });

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
    id: '3', desc: '打包代码',
    cmd: ['tar', ...tarExcludes, '-czf', tarPath, 'PapaCheck.Server', 'PapaCheck.Web'],
    cwd: ROOT, timeout: 120,
  });

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

  if (apkFile) {
    const apkName = apkFile.split('\\').pop() || apkFile.split('/').pop() || 'unknown.apk';
    steps.push({
      id: '4', desc: `上传 APK (${apkName})`,
      cmd: ['scp', ...SSH_OPTS, apkFile, `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}:/opt/papacheck/PapaCheck.Web/apk/`],
      timeout: 120,
    });
  }

  steps.push({
    id: String(apkFile ? 5 : 4), desc: '上传代码到服务器',
    cmd: ['scp', ...SSH_OPTS, tarPath, `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}:/opt/`],
    timeout: 120,
  });

  const remoteCmd = 'mkdir -p /opt/papacheck && '
    + 'cd /opt && tar xzf .publish.tar.gz -C /opt/papacheck && '
    + 'rm -f .publish.tar.gz && '
    + 'cd /opt/papacheck/PapaCheck.Server && '
    + 'npm ci --omit=dev --ignore-scripts && '
    + 'systemctl restart papacheck';
  steps.push({
    id: String(apkFile ? 6 : 5), desc: '远程安装依赖并重启',
    cmd: ['ssh', ...SSH_OPTS, `${CLOUD_SERVER_USER}@${CLOUD_SERVER_IP}`, remoteCmd],
    timeout: 300,
  });

  // 清理之前可能残留的 tar 文件
  try { unlinkSync(tarPath); } catch {}

  const success = await executor.runAndReport('云同步', steps);

  // 清理本次 tar 文件（如果上传步骤失败，本地 tar 可能未被清理）
  try { unlinkSync(tarPath); } catch {}

  return success;
}
