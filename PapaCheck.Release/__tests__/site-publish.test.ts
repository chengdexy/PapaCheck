// Feature: 站点部署（CloudBase Hosting）
//   作为发布工具
//   我希望通过 tcb hosting deploy 部署静态站点到 CloudBase
//   替代旧的 tar + SSH + 远程解压方式
//
//   Scenario: publishSite 调用 npm run build 和 tcb hosting deploy
//     Given 调用 publishSite
//     When 执行完成
//     Then execFile 以 'npm' 和 ['run','build'] 被调用
//     And execFile 以 'tcb' 和包含 ['hosting','deploy'] 的参数被调用
//
//   Scenario: publishWebApp 调用 tcb hosting deploy
//     Given 调用 publishWebApp
//     When 执行完成
//     Then execFile 以 'tcb' 和包含 ['hosting','deploy','.','--path','/papacheck/app/'] 的参数被调用

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, callback) => callback(null, { stdout: '', stderr: '' })),
}));

import { publishSite, publishWebApp } from '../lib/site-publish.js';

describe('site-publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishSite 调用 npm run build 和 tcb hosting deploy', async () => {
    await publishSite();
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith('npm', ['run', 'build'], expect.any(Object), expect.any(Function));
    expect(execFile).toHaveBeenCalledWith('tcb', expect.arrayContaining(['hosting', 'deploy']), expect.any(Object), expect.any(Function));
  });

  it('publishWebApp 调用 tcb hosting deploy', async () => {
    await publishWebApp();
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith('tcb', expect.arrayContaining(['hosting', 'deploy', '.', '--path', '/papacheck/app/']), expect.any(Object), expect.any(Function));
  });
});
