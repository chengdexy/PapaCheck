import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export interface DeployOptions {
  envId: string;
  cwd?: string;
}

/**
 * 以参数数组方式执行命令（不使用 shell，避免命令注入）。
 * cmd 为可执行文件，args 为独立参数；调用方传入的变量（如 functionName / envId）作为独立参数传递，
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

export async function deployFunction(
  functionName: string,
  options: DeployOptions
): Promise<void> {
  // 参数数组形式（无 shell），functionName / envId 均为独立参数
  await run('tcb', ['fn', 'deploy', functionName, '--env-id', options.envId], options.cwd);
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
    // 参数数组形式（无 shell），杜绝命令注入
    await run('tcb', ['config', 'update', 'fn', functionName, '--env-id', options.envId, '--json'], rcDir);
  } finally {
    // 清理（best-effort）
  }
}
