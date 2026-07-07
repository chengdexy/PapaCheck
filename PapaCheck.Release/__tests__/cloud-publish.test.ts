// Feature: 云函数发布（CloudBase）
//   作为发布工具
//   我希望通过 tcb fn deploy 部署云函数到 CloudBase
//   替代旧的 SSH + tar + systemctl 部署方式
//
//   Scenario: deployCloudFunction 调用 executeSteps 执行编译+部署
//     Given cloud-publish 模块已加载
//     When 调用 deployCloudFunction
//     Then executeSteps 被调用，包含编译和 tcb fn deploy 步骤
//
//   Scenario: updateApkVersion 调用 updateFunctionEnv
//     Given 指定版本号 1.6.0
//     When 调用 updateApkVersion('1.6.0')
//     Then updateFunctionEnv 以函数名 papacheck-api 和 { APK_VERSION: '1.6.0' } 被调用

import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/fn-deploy.js', () => ({
  deployFunction: vi.fn().mockResolvedValue(undefined),
  updateFunctionEnv: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/executor.js', () => ({
  executeSteps: vi.fn().mockResolvedValue(undefined),
}));

import { deployCloudFunction, updateApkVersion } from '../lib/cloud-publish.js';

describe('cloud-publish', () => {
  it('deployCloudFunction 调用 executeSteps', async () => {
    await deployCloudFunction();
    const { executeSteps } = await import('../lib/executor.js');
    expect(executeSteps).toHaveBeenCalled();
  });

  it('updateApkVersion 调用 updateFunctionEnv', async () => {
    await updateApkVersion('1.6.0');
    const { updateFunctionEnv } = await import('../lib/fn-deploy.js');
    expect(updateFunctionEnv).toHaveBeenCalledWith(
      'papacheck-api',
      { APK_VERSION: '1.6.0' },
      expect.any(Object)
    );
  });
});
