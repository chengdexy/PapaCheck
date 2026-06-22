// Feature: 云同步发布
//   作为发布工具
//   我希望 cloudPublish 生成正确的步骤序列
//   这样能可靠地将服务端代码部署到云端
//
//   Scenario: cloudPublish 包含 6 个标准步骤
//     Given 调用 cloudPublish
//     When executor.runAndReport 被调用
//     Then 步骤数组中包含: 测试 → 编译 → 打包 → (可选APK) → 上传 → SSH
//     And 至少包含 5 个步骤（APK 上传可选）

import { describe, test, expect, beforeAll } from 'vitest';
import { Executor } from '../lib/executor.js';
import { cloudPublish } from '../lib/cloud-publish.js';

describe('cloud-publish', () => {

  beforeAll(() => {
    process.env.PAPACHECK_CLOUD_IP = 'test.example.com';
    process.env.PAPACHECK_SSH_USER = 'testuser';
  });

  test('cloudPublish 至少产生 5 个步骤', async () => {
    const executor = new Executor();
    // 替换 runAndReport 来捕获步骤但不真正执行
    let capturedSteps: any[] = [];
    const originalRunAndReport = executor.runAndReport.bind(executor);
    executor.runAndReport = async (type: string, steps: any[]) => {
      capturedSteps = steps;
      return true;
    };

    await cloudPublish(executor);
    expect(capturedSteps.length).toBeGreaterThanOrEqual(5);
  });

});
