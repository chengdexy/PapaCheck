import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeManager } from '../js/realtime.js';

describe('RealtimeManager', () => {
  let realtime;

  beforeEach(() => {
    vi.useFakeTimers();
    realtime = new RealtimeManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start 后触发 onRefresh 回调并启动轮询', async () => {
    const callback = vi.fn();
    realtime.callbacks.onRefresh = callback;

    await realtime.start('tenant-1', 'child-1');

    // start 时立即触发一次 onRefresh
    expect(callback).toHaveBeenCalledTimes(1);

    // 模拟轮询间隔
    vi.advanceTimersByTime(30000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(30000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('stop 清除轮询', async () => {
    const callback = vi.fn();
    realtime.callbacks.onRefresh = callback;

    await realtime.start('tenant-1', 'child-1');
    expect(callback).toHaveBeenCalledTimes(1);

    realtime.stop();

    vi.advanceTimersByTime(60000);
    // stop 后轮询停止，回调不再触发
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('triggerAll 仅触发 onRefresh 回调', async () => {
    const refreshCb = vi.fn();
    const otherCb = vi.fn();
    realtime.callbacks.onRefresh = refreshCb;
    realtime.callbacks.onHomeworksChange = otherCb;
    realtime.callbacks.onSettlementChange = otherCb;

    realtime.triggerAll();

    // 仅 onRefresh 被调用，细粒度回调不被触发（轮询模式不需要逐个触发）
    expect(refreshCb).toHaveBeenCalledTimes(1);
    expect(otherCb).toHaveBeenCalledTimes(0);
  });

  it('onRefresh 异常被吞没不影响后续轮询', async () => {
    const errCb = vi.fn(() => { throw new Error('test error'); });
    realtime.callbacks.onRefresh = errCb;

    // triggerAll 应吞没异常
    expect(() => realtime.triggerAll()).not.toThrow();
    expect(errCb).toHaveBeenCalledTimes(1);
  });

  it('细粒度回调仍可被直接调用', () => {
    const change = { new: { id: 1, name: '作业1' }, old: null };
    expect(() => realtime.onHomeworksChange(change)).not.toThrow();
    expect(() => realtime.onNotificationsChange(change)).not.toThrow();
  });
});
