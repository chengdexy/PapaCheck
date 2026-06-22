import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { Executor, type StepDef } from './executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ANDROID_DIR = join(ROOT, 'PapaCheck.Android');
const PUBSPEC = join(ANDROID_DIR, 'pubspec.yaml');
const APK_BUILD_OUTPUT = join(ANDROID_DIR, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');
const APK_ARCHIVE_DIR = join(ANDROID_DIR, 'apk');

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
  if (args.noBump) return current;

  const bump = args.bump ?? 'patch';
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
  content = content.replace(/^(version:\s*)\S+/m, `$1${newVer}+0`);
  writeFileSync(PUBSPEC, content);
}

function _archiveApk(newVer: string): void {
  mkdirSync(APK_ARCHIVE_DIR, { recursive: true });
  const dst = join(APK_ARCHIVE_DIR, `PapaCheck-${newVer}.apk`);
  copyFileSync(APK_BUILD_OUTPUT, dst);
  // 清理旧 APK，保留最新 1 个
  const files = readdirSync(APK_ARCHIVE_DIR)
    .filter(f => f.startsWith('PapaCheck-') && f.endsWith('.apk') && f !== `PapaCheck-${newVer}.apk`);
  for (const f of files) unlinkSync(join(APK_ARCHIVE_DIR, f));
}

export async function buildApk(executor: Executor, args: { ver?: string; bump?: string; noBump?: boolean } = {}): Promise<boolean> {
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

  if (existsSync(APK_BUILD_OUTPUT)) {
    // 归档 APK：直接操作文件
    _archiveApk(newVer);
    steps.push({
      id: String(idx++), desc: `归档 APK → PapaCheck-${newVer}.apk`,
      cmd: ['node', '-e', `console.log('已归档: PapaCheck-${newVer}.apk')`],
      timeout: 5,
    });
  }

  return executor.runAndReport('构建 APK', steps);
}
