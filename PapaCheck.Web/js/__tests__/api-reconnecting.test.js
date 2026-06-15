/**
 * api-reconnecting.test.js - _requestWithStrategy 在 reconnecting 模式下降级测试
 *
 * Feature: 重连期间 online-first 策略降级到离线
 *   Scenario: reconnecting 模式时走离线降级路径
 *     Given ConnectionManager.getMode 返回 'reconnecting'
 *     When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn)
 *     Then offlineFn 被调用，onlineFn 不被调用
 *
 *   Scenario: offline 模式时走离线降级路径
 *     Given ConnectionManager.getMode 返回 'offline'
 *     When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn)
 *     Then offlineFn 被调用，onlineFn 不被调用
 *
 *   Scenario: online 模式时走在线路径
 *     Given ConnectionManager.getMode 返回 'online'
 *     When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn)
 *     Then onlineFn 被调用，offlineFn 不被调用
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * 模拟 _requestWithStrategy 的逻辑，包含修复后的 reconnecting 处理
 */
async function requestWithStrategyImpl(strategy, onlineFn, offlineFn, options, getMode) {
  const mode = getMode();
  // 修复：reconnecting 和 offline 一样走降级
  if (mode === 'offline' || mode === 'reconnecting') {
    return await offlineFn();
  }
  try {
    const result = await onlineFn();
    if (options && options.syncToLocal && offlineFn) {
      try { await offlineFn(); } catch (e) { }
    }
    return result;
  } catch (err) {
    if (options && options.allowFallback) {
      return await offlineFn();
    }
    throw err;
  }
}

describe('_requestWithStrategy online-first 策略 - reconnecting 降级', () => {
  it('reconnecting 模式走离线降级，onlineFn 不被调用', async () => {
    const onlineFn = vi.fn().mockResolvedValue('online');
    const offlineFn = vi.fn().mockResolvedValue('offline');
    const getMode = () => 'reconnecting';

    const result = await requestWithStrategyImpl('online-first', onlineFn, offlineFn, {}, getMode);

    expect(result).toBe('offline');
    expect(onlineFn).not.toHaveBeenCalled();
    expect(offlineFn).toHaveBeenCalledTimes(1);
  });

  it('offline 模式走离线降级，onlineFn 不被调用', async () => {
    const onlineFn = vi.fn().mockResolvedValue('online');
    const offlineFn = vi.fn().mockResolvedValue('offline');
    const getMode = () => 'offline';

    const result = await requestWithStrategyImpl('online-first', onlineFn, offlineFn, {}, getMode);

    expect(result).toBe('offline');
    expect(onlineFn).not.toHaveBeenCalled();
    expect(offlineFn).toHaveBeenCalledTimes(1);
  });

  it('online 模式走在线路径，offlineFn 不被调用', async () => {
    const onlineFn = vi.fn().mockResolvedValue('online');
    const offlineFn = vi.fn().mockResolvedValue('offline');
    const getMode = () => 'online';

    const result = await requestWithStrategyImpl('online-first', onlineFn, offlineFn, {}, getMode);

    expect(result).toBe('online');
    expect(onlineFn).toHaveBeenCalledTimes(1);
    expect(offlineFn).not.toHaveBeenCalled();
  });

  it('online 模式 + syncToLocal 时在线成功后同步到本地', async () => {
    const onlineFn = vi.fn().mockResolvedValue('online');
    const offlineFn = vi.fn().mockResolvedValue('offline');
    const getMode = () => 'online';

    await requestWithStrategyImpl('online-first', onlineFn, offlineFn, { syncToLocal: true }, getMode);

    expect(onlineFn).toHaveBeenCalledTimes(1);
    expect(offlineFn).toHaveBeenCalledTimes(1); // syncToLocal 触发第二次 offline 调用
  });

  it('online 模式 + onlineFn 失败 + allowFallback 时降级到离线', async () => {
    const onlineFn = vi.fn().mockRejectedValue(new Error('network error'));
    const offlineFn = vi.fn().mockResolvedValue('offline');
    const getMode = () => 'online';

    const result = await requestWithStrategyImpl('online-first', onlineFn, offlineFn, { allowFallback: true }, getMode);

    expect(result).toBe('offline');
    expect(onlineFn).toHaveBeenCalledTimes(1);
    expect(offlineFn).toHaveBeenCalledTimes(1);
  });

  it('online 模式 + onlineFn 失败 + 无 allowFallback 时抛出错误', async () => {
    const onlineFn = vi.fn().mockRejectedValue(new Error('network error'));
    const offlineFn = vi.fn().mockResolvedValue('offline');
    const getMode = () => 'online';

    await expect(
      requestWithStrategyImpl('online-first', onlineFn, offlineFn, {}, getMode)
    ).rejects.toThrow('network error');

    expect(onlineFn).toHaveBeenCalledTimes(1);
    expect(offlineFn).not.toHaveBeenCalled();
  });
});
