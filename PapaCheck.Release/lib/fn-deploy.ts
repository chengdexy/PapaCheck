import { execFile } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

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
  const args = ['fn', 'deploy', functionName, '--env-id', options.envId];
  await run('tcb', args, options.cwd);
}

/**
 * 更新云函数环境变量（仅更新配置，不重新部署代码）
 * 通过临时 cloudbaserc.json + tcb config update fn 实现
 */
export async function updateFunctionEnv(
  functionName: string,
  envVars: Record<string, string>,
  options: DeployOptions
): Promise<void> {
  const rcDir = join(tmpdir(), `papacheck-env-${randomUUID()}`);
  mkdirSync(rcDir, { recursive: true });
  const rcFile = join(rcDir, 'cloudbaserc.json');

  const rc = {
    envId: options.envId,
    version: '2.0',
    functions: [
      {
        name: functionName,
        config: {
          envVariables: envVars,
        },
      },
    ],
  };
  writeFileSync(rcFile, JSON.stringify(rc, null, 2), 'utf-8');

  try {
    await run('tcb', [
      'config', 'update', 'fn', functionName,
      '--env-id', options.envId,
      '--json',
    ], rcDir);
  } finally {
    // 清理（best-effort）
  }
}
