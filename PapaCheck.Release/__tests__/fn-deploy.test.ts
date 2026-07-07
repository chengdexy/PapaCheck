// Feature: 云函数部署

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, callback) => {
    if (typeof opts === 'function') callback = opts;
    callback(null, { stdout: '', stderr: '' });
  }),
}));

import { deployFunction, updateFunctionEnv } from '../lib/fn-deploy.js';

describe('云函数部署', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deployFunction 调用 tcb fn deploy', async () => {
    await deployFunction('papacheck-api', {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['fn', 'deploy', 'papacheck-api']),
      expect.any(Function)
    );
  });

  it('updateFunctionEnv 调用 tcb fn deploy --config-file', async () => {
    await updateFunctionEnv('papacheck-api', { APK_VERSION: '1.6.0' }, {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { execFile } = await import('child_process');
    // 验证被调用（含 cwd option 时为 4 参数）
    expect(execFile).toHaveBeenCalled();
    const call = (execFile as any).mock.calls[0];
    expect(call[0]).toBe('tcb');
    expect(call[1]).toEqual(expect.arrayContaining(['fn', 'deploy', 'papacheck-api', '--config-file']));
  });
});
