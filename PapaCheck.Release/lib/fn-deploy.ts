import { execFile } from 'child_process';

export interface DeployOptions {
  envId: string;
  cwd?: string;
}

function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const callback = (err: Error | null) => (err ? reject(err) : resolve());
    if (cwd) {
      execFile(cmd, args, { cwd }, callback);
    } else {
      execFile(cmd, args, callback);
    }
  });
}

export async function deployFunction(
  functionName: string,
  options: DeployOptions
): Promise<void> {
  const args = ['fn', 'deploy', functionName, '--envId', options.envId];
  await run('tcb', args, options.cwd);
}

export async function updateFunctionEnv(
  functionName: string,
  envVars: Record<string, string>,
  options: DeployOptions
): Promise<void> {
  const envArgs = Object.entries(envVars).map(([k, v]) => `--env ${k}=${v}`);
  const args = ['fn', 'update', functionName, '--envId', options.envId, ...envArgs];
  await run('tcb', args, options.cwd);
}
