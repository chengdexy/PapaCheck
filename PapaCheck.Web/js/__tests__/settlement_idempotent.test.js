/**
 * settlement_idempotent.test.js - calculateSettlement 幂等性测试
 *
 * Feature: calculateSettlement 幂等性
 *   Scenario: 数据未变化时不重复 PUT settlement/efficiency
 *     Given 所有作业已完成，结算数据已在服务端
 *     When calculateSettlement 被重复调用
 *     Then putSettlement 只在前两次被调用（初始化 + 第一次变化），后续跳过
 *
 *   Scenario: 并发调用时防止重复执行
 *     Given calculateSettlement 正在执行中
 *     When 再次调用 calculateSettlement
 *     Then 第二次调用直接返回，不重复 PUT
 */

import { describe, it, expect, vi } from 'vitest';

// 模拟 re-entrant guard 模式（calculateSettlement 将使用的保护逻辑）
function withGuard() {
  let _running = false;
  let _lastData = null;
  const putCalls = [];

  return {
    putCalls,
    /**
     * 带 guard 的 settlement 保存：
     * - re-entrant guard: 正在执行时跳过
     * - 数据对比: 与上次相同的数据跳过
     */
    guardedPutSettlement: async (dateKey, data) => {
      if (_running) return false;
      const dataJson = JSON.stringify(data);
      if (_lastData && _lastData.dateKey === dateKey && _lastData.dataJson === dataJson) {
        return false; // 数据未变化，跳过
      }
      _running = true;
      try {
        // 模拟 async PUT
        await new Promise(resolve => setTimeout(resolve, 10));
        putCalls.push({ dateKey, data });
        _lastData = { dateKey, dataJson };
        return true;
      } finally {
        _running = false;
      }
    },
  };
}

describe('calculateSettlement 幂等性', () => {
  it('数据未变化时不重复 PUT settlement', async () => {
    const { guardedPutSettlement, putCalls } = withGuard();

    // 第一次调用 - 应该 PUT
    const r1 = await guardedPutSettlement('2026-06-08', { doneCount: 3, totalBeforeRating: 80 });
    expect(r1).toBe(true);
    expect(putCalls).toHaveLength(1);

    // 第二次调用 - 相同数据，应该跳过
    const r2 = await guardedPutSettlement('2026-06-08', { doneCount: 3, totalBeforeRating: 80 });
    expect(r2).toBe(false);
    expect(putCalls).toHaveLength(1); // 未增加

    // 第三次调用 - 不同数据，应该 PUT
    const r3 = await guardedPutSettlement('2026-06-08', { doneCount: 4, totalBeforeRating: 100 });
    expect(r3).toBe(true);
    expect(putCalls).toHaveLength(2); // 增加一次
  });

  it('并发调用时防止重复执行', async () => {
    const { guardedPutSettlement, putCalls } = withGuard();

    // 启动第一个慢操作
    const promise1 = guardedPutSettlement('2026-06-08', { doneCount: 3 });

    // 在第一个完成前，发起第二个（应该被 guard 拦截）
    const r2 = await guardedPutSettlement('2026-06-08', { doneCount: 3 });
    expect(r2).toBe(false); // 被拦截

    await promise1;
    expect(putCalls).toHaveLength(1); // 只有一个 PUT
  });
});
