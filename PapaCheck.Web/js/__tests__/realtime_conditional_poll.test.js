/**
 * realtime_conditional_poll.test.js - 条件短轮询核心逻辑测试
 *
 * Feature: 条件短轮询（版本戳驱动）
 *   Scenario: 版本戳未变化时不触发全量刷新
 *   Scenario: 版本戳变化时触发一次全量刷新，并更新基线
 *   Scenario: burst 期间使用提速间隔，过期后回落到基础间隔
 *   Scenario: 页面不可见时使用降频间隔
 *
 * 说明：与项目内其他前端测试一致，这里复现 RealtimeManager 的决策逻辑，
 * 在 node 环境下验证算法本身（realtime.js 依赖 window/document，不便直接 import）。
 */

import { describe, it, expect } from 'vitest';

const POLL_INTERVAL_MS = 3000;
const HIDDEN_INTERVAL_MS = 15000;
const BURST_INTERVAL_MS = 1000;
const BURST_DURATION_MS = 6000;

// 复现 _checkVersion 的决策：返回 { refreshed, baseline }
function decideRefresh(lastVersion, newVersion) {
  if (newVersion !== lastVersion) {
    return { refreshed: true, baseline: newVersion };
  }
  return { refreshed: false, baseline: lastVersion };
}

// 复现 _currentInterval 的决策
function currentInterval(now, burstUntil, hidden) {
  if (now < burstUntil) return BURST_INTERVAL_MS;
  if (hidden) return HIDDEN_INTERVAL_MS;
  return POLL_INTERVAL_MS;
}

describe('条件短轮询核心逻辑', () => {
  it('版本戳未变化时不触发刷新', () => {
    const r = decideRefresh('2026-07-14T00:00:00Z|3', '2026-07-14T00:00:00Z|3');
    expect(r.refreshed).toBe(false);
    expect(r.baseline).toBe('2026-07-14T00:00:00Z|3');
  });

  it('版本戳变化时触发刷新并更新基线', () => {
    const r = decideRefresh('2026-07-14T00:00:00Z|3', '2026-07-14T00:00:05Z|4');
    expect(r.refreshed).toBe(true);
    expect(r.baseline).toBe('2026-07-14T00:00:05Z|4');
  });

  it('null → 有值 视为变化（首次出现数据）', () => {
    const r = decideRefresh(null, '2026-07-14T00:00:00Z|1');
    expect(r.refreshed).toBe(true);
    expect(r.baseline).toBe('2026-07-14T00:00:00Z|1');
  });

  it('burst 未过期时使用提速间隔', () => {
    const now = 10000;
    const burstUntil = now + BURST_DURATION_MS;
    expect(currentInterval(now, burstUntil, false)).toBe(BURST_INTERVAL_MS);
  });

  it('burst 过期后回落到基础间隔', () => {
    const now = 20000;
    const burstUntil = 15000; // 已过期
    expect(currentInterval(now, burstUntil, false)).toBe(POLL_INTERVAL_MS);
  });

  it('页面不可见时使用降频间隔', () => {
    const now = 20000;
    expect(currentInterval(now, 0, true)).toBe(HIDDEN_INTERVAL_MS);
  });

  it('burst 优先级高于后台降频', () => {
    const now = 10000;
    const burstUntil = now + 1000;
    expect(currentInterval(now, burstUntil, true)).toBe(BURST_INTERVAL_MS);
  });
});
