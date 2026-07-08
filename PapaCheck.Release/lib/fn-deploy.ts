import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

export interface DeployOptions {
  envId: string;
  cwd?: string;
}

function run(cmd: string, cwd?: string): Promise<void> {
  const opts = cwd ? { cwd } : {};
  return execAsync(cmd, opts) as unknown as Promise<void>;
}

export async function deployFunction(
  functionName: string,
  options: DeployOptions
): Promise<void> {
  await run(`tcb fn deploy ${functionName} --env-id ${options.envId}`, options.cwd);
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
    await run(`tcb config update fn ${functionName} --env-id ${options.envId} --json`, rcDir);
  } finally {
    // 清理（best-effort）
  }
}
