// Feature: 站点部署（CloudBase Hosting）
//   作为发布工具
//   我希望通过 tcb hosting deploy 部署静态站点到 CloudBase
//   替代旧的 tar + SSH + 远程解压方式
//
//   Scenario: publishSite 调用 npm run build 和 tcb hosting deploy
//     Given 调用 publishSite
//     When 执行完成
//     Then spawn 以 'npm' 和 ['run','build'] 被调用
//     And spawn 以 'tcb' 和包含 ['hosting','deploy'] 的参数被调用
//
//   Scenario: publishWebApp 调用 tcb hosting deploy
//     Given 调用 publishWebApp
//     When 执行完成
//     Then spawn 以 'tcb' 和包含 ['hosting','deploy','.','papacheck/app','--env-id'] 的参数被调用

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 以参数数组方式 mock spawn（不使用 exec/execFile/shell），与 site-publish 实际改后的调用一致。
vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], _opts: unknown, callback?: (err: unknown, out: unknown) => void) => {
    const proc: any = {
      stderr: { on: (_ev: string, _cb: unknown) => {} },
      on: (ev: string, cb: (code: number) => void) => {
        if (ev === 'close') cb(0);
      },
    };
    if (typeof callback === 'function') callback(null, { stdout: '', stderr: '' });
    return proc;
  }),
}));

import { publishSite, publishWebApp } from '../lib/site-publish.js';

describe('site-publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishSite 调用 npm run build 和 tcb hosting deploy', async () => {
    await publishSite();
    const { spawn } = await import('child_process');
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'build'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('tcb', expect.arrayContaining(['hosting', 'deploy']), expect.any(Object));
  });

  it('publishWebApp 调用 tcb hosting deploy', async () => {
    await publishWebApp();
    const { spawn } = await import('child_process');
    expect(spawn).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['hosting', 'deploy', '.', 'papacheck/app', '--env-id']),
      expect.any(Object),
    );
  });
});
