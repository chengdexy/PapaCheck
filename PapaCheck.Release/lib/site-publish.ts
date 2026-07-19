import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENV_ID = 'child-teacher-parent-d9aef9d2208';

/**
 * 以参数数组方式执行命令（不使用 shell，避免命令注入）。
 * cmd 为可执行文件，args 为独立参数；传入的 ENV_ID 作为独立参数传递，
 * 不会被 shell 重新解析，从而杜绝拼接注入风险。
 */
function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`命令执行失败 (exit ${code}): ${stderr.trim() || cmd}`));
      }
    });
    proc.on('error', (err) => reject(err));
  });
}

export async function publishSite(): Promise<void> {
  const siteDir = join(ROOT, 'PapaCheck.Site');
  await run('npm', ['run', 'build'], siteDir);
  await run('tcb', ['hosting', 'deploy', 'dist/', 'papacheck', '--env-id', ENV_ID], siteDir);
}

export async function publishWebApp(): Promise<void> {
  await run('tcb', ['hosting', 'deploy', '.', 'papacheck/app', '--env-id', ENV_ID], join(ROOT, 'PapaCheck.Web'));
}
