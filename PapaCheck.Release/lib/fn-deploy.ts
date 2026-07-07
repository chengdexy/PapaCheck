import { execFile } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
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
 * 更新云函数环境变量
 * tcb CLI 无直接 env update 命令，通过临时 cloudbaserc.json 配合 tcb fn deploy 实现
 */
export async function updateFunctionEnv(
  functionName: string,
  envVars: Record<string, string>,
  options: DeployOptions
): Promise<void> {
  // 写临时 cloudbaserc.json，利用 deploy 读取 envVariables 的能力
  const tmpFile = join(tmpdir(), `cloudbaserc-${randomUUID()}.json`);
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
  writeFileSync(tmpFile, JSON.stringify(rc, null, 2), 'utf-8');

  try {
    // --config-file 指定 rc 文件，--force 跳过确认，--yes 自动确认
    await run('tcb', [
      'fn', 'deploy', functionName,
      '--env-id', options.envId,
      '--force', '--yes',
      '--config-file', tmpFile,
    ], options.cwd);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}
