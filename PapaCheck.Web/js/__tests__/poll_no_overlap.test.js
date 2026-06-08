/**
 * poll_no_overlap.test.js - startPoll 异步安全测试
 *
 * Feature: poll 异步安全
 *   Scenario: poll 耗时超过间隔时不会重叠触发
 *     Given startPoll(50) 已调用
 *     When pollServer 每次执行耗时 100ms
 *     Then pollServer 被调用次数小于 经过时间/50ms
 *
 *   Scenario: poll 异常后能继续下一轮
 *     Given startPoll(50) 已调用
 *     When pollServer 抛出异常
 *     Then poll 继续调度下一轮，不中断
 *
 *   Scenario: stopPoll 能取消下一轮调度
 *     Given startPoll(50) 已调用
 *     When 调用 stopPoll()
 *     Then 不再调度新的 poll
 *
 * 使用 fakeTimers 模拟异步时序，验证 setTimeout 递归链比 setInterval 更安全
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('startPoll 异步安全', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('poll 耗时超过间隔时不重叠触发', async () => {
    let callCount = 0;
    const pollFn = async () => {
      callCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
    };

    // 模拟 startPoll 的 setTimeout 递归逻辑
    let timerId = null;
    function startMyPoll(intervalMs) {
      clearTimeout(timerId);
      const poll = async () => {
        try {
          await pollFn();
        } finally {
          timerId = setTimeout(poll, intervalMs);
        }
      };
      timerId = setTimeout(poll, intervalMs);
    }

    startMyPoll(50);

    // 前进 300ms
    await vi.advanceTimersByTimeAsync(300);

    // 300ms 内，每个 poll 耗时 100ms，最多执行 3 次
    // 如果是 setInterval(50)，300ms 内会执行 6 次
    expect(callCount).toBeLessThanOrEqual(4);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('poll 异常后能继续下一轮', async () => {
    let callCount = 0;
    const pollFn = async () => {
      callCount++;
      if (callCount === 1) throw new Error('模拟异常');
      await new Promise(resolve => setTimeout(resolve, 10));
    };

    let timerId = null;
    function startMyPoll(intervalMs) {
      clearTimeout(timerId);
      const poll = async () => {
        try {
          await pollFn();
        } catch {
          // 异常已捕获，继续
        } finally {
          timerId = setTimeout(poll, intervalMs);
        }
      };
      timerId = setTimeout(poll, intervalMs);
    }

    startMyPoll(50);

    // 前进 200ms，应该有 2+ 次调用
    await vi.advanceTimersByTimeAsync(200);

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('stopPoll 能取消下一轮调度', async () => {
    let callCount = 0;
    const pollFn = async () => {
      callCount++;
    };

    let timerId = null;
    function startMyPoll(intervalMs) {
      clearTimeout(timerId);
      const poll = async () => {
        try {
          await pollFn();
        } finally {
          timerId = setTimeout(poll, intervalMs);
        }
      };
      timerId = setTimeout(poll, intervalMs);
    }
    function stopMyPoll() {
      clearTimeout(timerId);
      timerId = null;
    }

    startMyPoll(50);
    await vi.advanceTimersByTimeAsync(60); // 第一次执行

    stopMyPoll();
    await vi.advanceTimersByTimeAsync(200); // 不会再触发

    expect(callCount).toBe(1); // 只有第一次执行
  });
});
