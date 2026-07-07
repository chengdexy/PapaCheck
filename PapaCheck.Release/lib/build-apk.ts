import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { Executor, type StepDef } from './executor.js';
import { CDN_BASE_URL } from './storage-upload.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ANDROID_DIR = join(ROOT, 'PapaCheck.Android');
const PUBSPEC = join(ANDROID_DIR, 'pubspec.yaml');
const APK_BUILD_OUTPUT = join(ANDROID_DIR, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');
const APK_ARCHIVE_DIR = join(ANDROID_DIR, 'apk');
const SSH_OPTS = ['-o', 'StrictHostKeyChecking=accept-new'];
const CLOUDBASE_ENV = 'child-teacher-parent-d9aef9d2208';

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function readApkVersion(): string {
  try {
    const content = readFileSync(PUBSPEC, 'utf-8');
    const m = content.match(/^version:\s*(\S+)/m);
    if (m) return m[1].split('+')[0];
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function resolveVersion(current: string, args: { ver?: string; bump?: string; noBump?: boolean }): string {
  if (args.ver) {
    if (!VERSION_RE.test(args.ver)) {
      throw new Error(`版本号格式错误: "${args.ver}"，请输入 X.Y.Z，如 1.2.3`);
    }
    return args.ver;
  }
  // 默认不递增版本号，需用户显式指定 --bump
  if (args.noBump || !args.bump) return current;

  const bump = args.bump;
  const m = current.match(VERSION_RE);
  if (!m) return current;
  const ma = Number(m[1]), mi = Number(m[2]), pa = Number(m[3]);
  switch (bump) {
    case 'major': return `${ma + 1}.0.0`;
    case 'minor': return `${ma}.${mi + 1}.0`;
    case 'patch': return `${ma}.${mi}.${pa + 1}`;
    default: return current;
  }
}

function _updatePubspecVersion(newVer: string): void {
  let content = readFileSync(PUBSPEC, 'utf-8');
  // 保留已有构建号，防止每次递增版本时构建号被重置为 0
  const buildMatch = content.match(/^version:\s*\S+\+(\d+)/m);
  const buildNum = buildMatch ? buildMatch[1] : '0';
  content = content.replace(/^(version:\s*)\S+/m, `$1${newVer}+${buildNum}`);
  writeFileSync(PUBSPEC, content);
}

export async function buildApk(executor: Executor, args: { ver?: string; bump?: string; noBump?: boolean; publish?: boolean; publishOnBuild?: boolean } = {}): Promise<boolean> {
  const currentVer = readApkVersion();
  const newVer = resolveVersion(currentVer, args);
  const steps: StepDef[] = [];
  let idx = 1;

  if (newVer !== currentVer) {
    // 版本号递增：直接操作文件，不经过子进程（避免 Windows shell 引号问题）
    _updatePubspecVersion(newVer);
    steps.push({
      id: String(idx++), desc: `版本号递增 ${currentVer} → ${newVer}`,
      cmd: ['node', '-e', `console.log('版本号: ${currentVer} → ${newVer}')`],
      timeout: 5,
    });
  }

  steps.push({
    id: String(idx++), desc: '构建 APK',
    cmd: 'flutter build apk --release', cwd: ANDROID_DIR, shell: true, timeout: 300,
  });

  // 归档 APK：构建成功后执行，作为 executor step 避免构建前误归档旧版 APK
  {
    const src = JSON.stringify(APK_BUILD_OUTPUT);
    const dir = JSON.stringify(APK_ARCHIVE_DIR);
    const ver = newVer;
    const code = `const f=require('fs'),j=require('path');const s=${src};if(!f.existsSync(s)){console.error('APK 未找到: '+s);process.exit(1)}const d=${dir};f.mkdirSync(d,{recursive:true});const dst=j.join(d,'PapaCheck-${ver}.apk');f.copyFileSync(s,dst);f.readdirSync(d).filter(x=>x.startsWith('PapaCheck-')&&x.endsWith('.apk')&&x!=='PapaCheck-${ver}.apk').forEach(x=>f.unlinkSync(j.join(d,x)));console.log('已归档: PapaCheck-${ver}.apk')`;
    steps.push({
      id: String(idx++), desc: `归档 APK → PapaCheck-${newVer}.apk`,
      cmd: ['node', '-e', code], timeout: 10,
    });
  }

  // --publish：上传到 CloudBase 并更新 ECS 版本号
  let remoteIp = '';
  try {
    const envFile = readFileSync(join(ROOT, 'PapaCheck.Release', '.env'), 'utf-8');
    const ipMatch = envFile.match(/^PAPACHECK_CLOUD_IP=(.+)/m);
    if (ipMatch) remoteIp = ipMatch[1].trim();
  } catch {}
  if (!remoteIp) remoteIp = process.env.PAPACHECK_CLOUD_IP || '';
  if (args.publish && remoteIp) {
    const apkPath = join(APK_ARCHIVE_DIR, `PapaCheck-${newVer}.apk`);
    if (existsSync(apkPath)) {
      steps.push({
        id: String(idx++), desc: `上传 APK 到 CloudBase (PapaCheck-${newVer}.apk)`,
        shell: true,
        cmd: `tcb storage objects upload ${apkPath} PapaCheck-${newVer}.apk --bucket dist --env-id ${CLOUDBASE_ENV} --content-type application/vnd.android.package-archive --use-put --json`,
        timeout: 120,
      });

      steps.push({
        id: String(idx++), desc: `更新 ECS 环境变量 PAPACHECK_CLIENT_VERSION=${newVer}`,
        cmd: ['ssh', ...SSH_OPTS, `root@${remoteIp}`,
          `grep -q '^Environment=PAPACHECK_CLIENT_VERSION=' /etc/systemd/system/papacheck.service && sed -i "s/^Environment=PAPACHECK_CLIENT_VERSION=.*/Environment=PAPACHECK_CLIENT_VERSION='${newVer}'/" /etc/systemd/system/papacheck.service || sed -i "/^Environment=NODE_ENV=/a Environment=PAPACHECK_CLIENT_VERSION='${newVer}'" /etc/systemd/system/papacheck.service && systemctl daemon-reload && systemctl restart papacheck`],
        timeout: 60,
      });
    }
  }

  // --publishOnBuild：构建后上传云存储（版本号已硬编码在云函数代码中，重新部署即可生效）
  if (args.publishOnBuild) {
    const apkPath = join(APK_ARCHIVE_DIR, `PapaCheck-${newVer}.apk`);
    steps.push({
      id: String(idx++), desc: `上传 APK 到 CloudBase 云存储 (PapaCheck-${newVer}.apk)`,
      shell: true,
      cmd: `tcb storage objects upload ${apkPath} PapaCheck-${newVer}.apk --bucket dist --env-id ${CLOUDBASE_ENV} --upsert`,
      timeout: 120,
    });
    // 同步云函数 package.json 版本号，并自动构建+部署云函数
    const cfDir = join(ROOT, 'PapaCheck.CloudFunc', 'papacheck-api');
    const cfPkgPath = join(cfDir, 'package.json');
    if (existsSync(cfPkgPath)) {
      const cfPkg = JSON.parse(readFileSync(cfPkgPath, 'utf-8'));
      cfPkg.version = newVer;
      writeFileSync(cfPkgPath, JSON.stringify(cfPkg, null, 2) + '\n', 'utf-8');
      steps.push({
        id: String(idx++), desc: `构建云函数 (v${newVer})`,
        shell: true,
        cmd: `npm run build`,
        cwd: cfDir,
        timeout: 30,
      });
      // 生成 cloudbaserc.json（包含完整环境变量，避免 tcb fn deploy 清空已有变量）
      const cfDist = join(cfDir, 'dist');
      writeFileSync(join(cfDist, 'cloudbaserc.json'), JSON.stringify({
        envId: CLOUDBASE_ENV,
        version: '2.0',
        functions: [{
          name: 'papacheck-api',
          config: {
            timeout: 30,
            runtime: 'Nodejs18.15',
            envVariables: {
              DATABASE_URL: 'postgresql://chengdexy:XY%40dly%26xjy1314@172.17.0.8:5432/postgres',
              ENCRYPTION_KEY: '',
              JWT_EXPIRES_IN: '30d',
              JWT_SECRET: 'd6f21d968b5c7315c21c2f4ff0deac260103ef09f21332d9dfafc3d342e553a5',
            },
          },
        }],
      }, null, 2), 'utf-8');
      steps.push({
        id: String(idx++), desc: `部署云函数 ${newVer}`,
        shell: true,
        cmd: `tcb fn deploy papacheck-api --env-id ${CLOUDBASE_ENV} --force --yes --dir .`,
        cwd: cfDist,
        timeout: 60,
      });
    }
  }

  return executor.runAndReport('构建 APK', steps);
}
