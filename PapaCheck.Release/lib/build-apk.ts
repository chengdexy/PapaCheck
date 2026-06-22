import { readFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
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

export async function buildApk(executor: Executor, args: { ver?: string; bump?: string; noBump?: boolean } = {}): Promise<boolean> {
  const currentVer = readApkVersion();
  const newVer = resolveVersion(currentVer, args);
  const steps: StepDef[] = [];
  let idx = 1;

  if (newVer !== currentVer) {
    const setVerCmd = `npx tsx -e "
import { readFileSync, writeFileSync } from 'fs';
const p = '${PUBSPEC.replace(/\\/g, '/')}';
let c = readFileSync(p, 'utf-8');
c = c.replace(/^(version:\\s*)\\S+/m, '$1${newVer}+0');
writeFileSync(p, c);
console.log('版本号: ${currentVer} \\u2192 ${newVer}');
"`;
    steps.push({
      id: String(idx++), desc: `版本号递增 ${currentVer} → ${newVer}`,
      cmd: setVerCmd, cwd: ROOT, shell: true, timeout: 10,
    });
  }

  steps.push({
    id: String(idx++), desc: '构建 APK',
    cmd: 'flutter build apk --release', cwd: ANDROID_DIR, shell: true, timeout: 300,
  });

  steps.push({
    id: String(idx++), desc: '归档 APK',
    cmd: `npx tsx -e "
import { mkdirSync, copyFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
const src = '${APK_BUILD_OUTPUT.replace(/\\/g, '/')}';
const dstDir = '${APK_ARCHIVE_DIR.replace(/\\/g, '/')}';
mkdirSync(dstDir, { recursive: true });
const dst = join(dstDir, 'PapaCheck-${newVer}.apk');
copyFileSync(src, dst);
console.log('APK\\u5F52\\u6863\\u2192 ' + dst);
if (existsSync(dstDir)) {
  const files = readdirSync(dstDir).filter(f => f.startsWith('PapaCheck-') && f.endsWith('.apk') && f !== 'PapaCheck-${newVer}.apk');
  files.forEach(f => unlinkSync(join(dstDir, f)));
}
"`,
    cwd: ROOT, shell: true, timeout: 10,
  });

  return executor.runAndReport('构建 APK', steps);
}
