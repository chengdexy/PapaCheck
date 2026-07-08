import { exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENV_ID = 'child-teacher-parent-d9aef9d2208';

export async function publishSite(): Promise<void> {
  const siteDir = join(ROOT, 'PapaCheck.Site');
  await execAsync('npm run build', { cwd: siteDir });
  await execAsync(`tcb hosting deploy dist/ papacheck --env-id ${ENV_ID}`, { cwd: siteDir });
}

export async function publishWebApp(): Promise<void> {
  await execAsync(`tcb hosting deploy . papacheck/app --env-id ${ENV_ID}`, {
    cwd: join(ROOT, 'PapaCheck.Web'),
  });
}
