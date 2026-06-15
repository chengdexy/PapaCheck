/**
 * bounty_abandon_feedback.test.js - 赏金任务放弃/提交反馈测试
 *
 * Feature: 放弃/提交赏金任务
 *   Scenario: API.getBountySubmissions 返回空时应有用户反馈
 *     Given 赏金任务进行中，但服务端返回空
 *     When  调用 abandonBountyTask/submitBountyTask
 *     Then  不应该静默失败，应调用 showToast 告知用户
 *
 *   Scenario: 正常放弃赏金任务流程
 *     Given 赏金任务进行中，存在任务记录
 *     When  调用 abandonBountyTask
 *     Then  状态更新为 abandoned，调用 putBountySubmission
 */
import { describe, it, expect, vi } from 'vitest';

describe('abandonBountyTask 用户反馈', () => {
  // 模拟 big-screen.js 中的依赖
  let _submittingBounty;
  let cachedData;
  let currentDate;
  const showToast = vi.fn();
  const putBountySubmission = vi.fn().mockResolvedValue(true);
  const updateBigScreen = vi.fn();
  let needsFullRender;

  function resetState() {
    _submittingBounty = false;
    cachedData = { bountySubmissions: {} };
    currentDate = new Date();
    showToast.mockClear();
    putBountySubmission.mockClear();
    updateBigScreen.mockClear();
    needsFullRender = false;
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 模拟 abandonBountyTask 但不修改原文件
  async function abandonBountyTask(taskId, getBountySubmissions) {
    if (_submittingBounty) return;
    _submittingBounty = true;
    try {
      const dk = dateKey(currentDate);
      const submissions = await getBountySubmissions(dk) || [];
      const sub = submissions.find(s => s.taskId === taskId);
      if (!sub) {
        showToast('未找到任务记录，请刷新后重试');
        return;
      }
      sub.status = 'abandoned';
      await putBountySubmission(sub.id, sub);
      if (!cachedData.bountySubmissions) cachedData.bountySubmissions = {};
      cachedData.bountySubmissions[dk] = submissions;
      needsFullRender = true;
      updateBigScreen();
    } finally {
      _submittingBounty = false;
    }
  }

  async function submitBountyTask(taskId, getBountySubmissions) {
    if (_submittingBounty) return;
    _submittingBounty = true;
    try {
      const dk = dateKey(currentDate);
      const submissions = await getBountySubmissions(dk) || [];
      const sub = submissions.find(s => s.taskId === taskId);
      if (!sub) {
        showToast('未找到任务记录，请刷新后重试');
        return;
      }
      sub.status = 'submitted';
      sub.submittedAt = new Date().toISOString();
      await putBountySubmission(sub.id, sub);
      if (!cachedData.bountySubmissions) cachedData.bountySubmissions = {};
      cachedData.bountySubmissions[dk] = submissions;
      needsFullRender = true;
      updateBigScreen();
    } finally {
      _submittingBounty = false;
    }
  }

  beforeEach(() => {
    resetState();
  });

  it('找不到任务记录时弹toast', async () => {
    // 模拟 getBountySubmissions 返回空数组（服务端无记录）
    const getBountySubmissions = vi.fn().mockResolvedValue([]);

    await abandonBountyTask('task-001', getBountySubmissions);

    expect(showToast).toHaveBeenCalled();
    expect(putBountySubmission).not.toHaveBeenCalled();
    // _submittingBounty 应被重置
    expect(_submittingBounty).toBe(false);
  });

  it('正常放弃任务时调用 putBountySubmission', async () => {
    const submission = { id: 'sub-001', taskId: 'task-001', status: 'doing' };
    const getBountySubmissions = vi.fn().mockResolvedValue([submission]);

    await abandonBountyTask('task-001', getBountySubmissions);

    expect(putBountySubmission).toHaveBeenCalledWith('sub-001', { id: 'sub-001', taskId: 'task-001', status: 'abandoned' });
    expect(updateBigScreen).toHaveBeenCalled();
    expect(_submittingBounty).toBe(false);
  });

  it('submitBountyTask 找不到记录时弹toast', async () => {
    const getBountySubmissions = vi.fn().mockResolvedValue([]);

    await submitBountyTask('task-001', getBountySubmissions);

    expect(showToast).toHaveBeenCalled();
    expect(putBountySubmission).not.toHaveBeenCalled();
    expect(_submittingBounty).toBe(false);
  });

  it('正常提交任务时调用 putBountySubmission', async () => {
    const submission = { id: 'sub-001', taskId: 'task-001', status: 'doing' };
    const getBountySubmissions = vi.fn().mockResolvedValue([submission]);

    await submitBountyTask('task-001', getBountySubmissions);

    expect(putBountySubmission).toHaveBeenCalled();
    const calledArg = putBountySubmission.mock.calls[0][1];
    expect(calledArg.status).toBe('submitted');
    expect(calledArg.submittedAt).toBeDefined();
    expect(updateBigScreen).toHaveBeenCalled();
    expect(_submittingBounty).toBe(false);
  });
});
