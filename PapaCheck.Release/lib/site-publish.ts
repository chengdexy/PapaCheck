import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENV_ID = 'child-teacher-parent-d9aef9d2208';

export async function publishSite(): Promise<void> {
  const siteDir = join(ROOT, 'PapaCheck.Site');
  await execFileAsync('npm', ['run', 'build'], { cwd: siteDir });
  await execFileAsync('tcb', [
    'hosting', 'deploy', 'dist/', '--path', '/papacheck/',
    '--envId', ENV_ID,
  ], { cwd: siteDir });
}

export async function publishWebApp(): Promise<void> {
  await execFileAsync('tcb', [
    'hosting', 'deploy', '.', '--path', '/papacheck/app/',
    '--envId', ENV_ID,
  ], { cwd: join(ROOT, 'PapaCheck.Web') });
}
