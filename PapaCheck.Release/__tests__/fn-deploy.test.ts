// Feature: 云函数部署

import { describe, it, expect, vi, beforeEach } from 'vitest';

// fn-deploy.ts 已改为使用 spawn（参数数组，无 shell）以消除命令注入，
// 此处 mock child_process.spawn，并断言调用参数正确。
vi.mock('child_process', () => {
  const spawn = vi.fn((_cmd: string, _args: string[], _opts: any) => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: (event: string, cb: (code?: number) => void) => {
      if (event === 'close') cb(0);
    },
  }));
  return { spawn };
});

import { deployFunction, updateFunctionEnv } from '../lib/fn-deploy.js';

describe('云函数部署', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deployFunction 调用 tcb fn deploy', async () => {
    await deployFunction('papacheck-api', {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { spawn } = await import('child_process');
    expect(spawn).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['fn', 'deploy', 'papacheck-api']),
      expect.any(Object)
    );
  });

  it('updateFunctionEnv 调用 tcb config update fn', async () => {
    await updateFunctionEnv('papacheck-api', { APK_VERSION: '1.6.0' }, {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { spawn } = await import('child_process');
    expect(spawn).toHaveBeenCalled();
    const call = (spawn as any).mock.calls[0];
    expect(call[0]).toBe('tcb');
    expect(call[1]).toEqual(expect.arrayContaining(['config', 'update', 'fn', 'papacheck-api']));
  });
});
