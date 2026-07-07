// Feature: 云函数部署
//   作为发布工具
//   我希望通过 tcb CLI 部署云函数到 CloudBase
//   这样能替代旧的 SSH 部署方式
//
//   Scenario: deployFunction 调用 tcb fn deploy
//     Given 指定云函数名 papacheck-api 和环境 ID
//     When 调用 deployFunction
//     Then execFile 以 'tcb' 和 ['fn','deploy','papacheck-api'] 参数被调用
//
//   Scenario: updateFunctionEnv 调用 tcb fn update
//     Given 指定云函数名和待更新环境变量
//     When 调用 updateFunctionEnv
//     Then execFile 以 'tcb' 和 ['fn','update','papacheck-api'] 参数被调用

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, callback) => callback(null, { stdout: '', stderr: '' })),
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

  it('updateFunctionEnv 调用 tcb fn update', async () => {
    await updateFunctionEnv('papacheck-api', { APK_VERSION: '1.6.0' }, {
      envId: 'child-teacher-parent-d9aef9d2208',
    });
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['fn', 'update', 'papacheck-api']),
      expect.any(Function)
    );
  });
});
