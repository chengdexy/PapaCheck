import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { updateFunctionEnv } from './fn-deploy.js';
import { executeSteps, type Step } from './executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLOUD_FUNC_DIR = join(ROOT, 'PapaCheck.CloudFunc', 'papacheck-api');

const ENV_ID = 'child-teacher-parent-d9aef9d2208';

export async function deployCloudFunction(): Promise<void> {
  const steps: Step[] = [
    {
      name: '编译云函数',
      cmd: 'npm',
      args: ['run', 'build'],
      cwd: CLOUD_FUNC_DIR,
    },
    {
      name: '部署云函数',
      cmd: 'tcb',
      args: ['fn', 'deploy', 'papacheck-api', '--envId', ENV_ID],
      cwd: CLOUD_FUNC_DIR,
    },
  ];
  await executeSteps(steps);
}

export async function updateApkVersion(version: string): Promise<void> {
  await updateFunctionEnv('papacheck-api', { APK_VERSION: version }, { envId: ENV_ID });
}
