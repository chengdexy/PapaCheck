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

  it('start 后触发回调并启动轮询', async () => {
    const callback = vi.fn();
    realtime.callbacks.onHomeworksChange = callback;

    await realtime.start('tenant-1', 'child-1');

    // start 时立即触发一次回调
    expect(callback).toHaveBeenCalledTimes(1);

    // 模拟轮询间隔
    vi.advanceTimersByTime(30000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(30000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('stop 清除轮询', async () => {
    const callback = vi.fn();
    realtime.callbacks.onHomeworksChange = callback;

    await realtime.start('tenant-1', 'child-1');
    expect(callback).toHaveBeenCalledTimes(1);

    realtime.stop();

    vi.advanceTimersByTime(60000);
    // stop 后轮询停止，回调不再触发
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('回调异常不影响其他回调', async () => {
    const errorCb = vi.fn(() => { throw new Error('test error'); });
    const normalCb = vi.fn();
    realtime.callbacks.onHomeworksChange = errorCb;
    realtime.callbacks.onSettlementChange = normalCb;

    await realtime.start('tenant-1', null);
    expect(normalCb).toHaveBeenCalledTimes(1);
    expect(errorCb).toHaveBeenCalledTimes(1);
  });

  it('onHomeworksChange 回调可被调用', () => {
    const change = { new: { id: 1, name: '作业1' }, old: null };
    expect(() => realtime.onHomeworksChange(change)).not.toThrow();
  });
});
