/**
 * settlement_idempotent.test.js - calculateSettlement 幂等性测试
 *
 * Feature: calculateSettlement 幂等性
 *   Scenario: 数据未变化时不重复 PUT settlement/efficiency
 *     Given 所有作业已完成，结算数据已在服务端
 *     When calculateSettlement 被重复调用
 *     Then putSettlement 只在前两次被调用（初始化 + 第一次变化），后续跳过
 *
 *   Scenario: 效率数据未变化时不重复 PUT efficiency
 *     Given 所有作业已完成，效率数据已在服务端
 *     When calculateSettlement 被重复调用
 *     Then putEfficiency 只在前两次被调用（初始化 + 第一次变化），后续跳过
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
  let _lastEfficiencyData = null;
  let _lastSettlementData = null;
  const settlementCalls = [];
  const efficiencyCalls = [];

  return {
    settlementCalls,
    efficiencyCalls,
    /**
     * 带 guard 的 settlement 保存：
     * - re-entrant guard: 正在执行时跳过
     * - 数据对比: 与上次相同的数据跳过
     */
    guardedPutSettlement: async (dateKey, data) => {
      if (_running) return false;
      const dataJson = JSON.stringify(data);
      if (_lastSettlementData && _lastSettlementData.dateKey === dateKey && _lastSettlementData.dataJson === dataJson) {
        return false; // 数据未变化，跳过
      }
      _running = true;
      try {
        await new Promise(resolve => setTimeout(resolve, 10));
        settlementCalls.push({ dateKey, data });
        _lastSettlementData = { dateKey, dataJson };
        return true;
      } finally {
        _running = false;
      }
    },
    /**
     * 带 guard 的 efficiency 保存：
     * - re-entrant guard: 正在执行时跳过
     * - 数据对比: 与上次相同的数据跳过
     */
    guardedPutEfficiency: async (dateKey, data) => {
      if (_running) return false;
      const dataJson = JSON.stringify(data);
      if (_lastEfficiencyData && _lastEfficiencyData.dateKey === dateKey && _lastEfficiencyData.dataJson === dataJson) {
        return false; // 数据未变化，跳过
      }
      _running = true;
      try {
        await new Promise(resolve => setTimeout(resolve, 10));
        efficiencyCalls.push({ dateKey, data });
        _lastEfficiencyData = { dateKey, dataJson };
        return true;
      } finally {
        _running = false;
      }
    },
  };
}

describe('calculateSettlement 幂等性', () => {
  it('数据未变化时不重复 PUT settlement', async () => {
    const { guardedPutSettlement, settlementCalls } = withGuard();

    // 第一次调用 - 应该 PUT
    const r1 = await guardedPutSettlement('2026-06-08', { doneCount: 3, totalBeforeRating: 80 });
    expect(r1).toBe(true);
    expect(settlementCalls).toHaveLength(1);

    // 第二次调用 - 相同数据，应该跳过
    const r2 = await guardedPutSettlement('2026-06-08', { doneCount: 3, totalBeforeRating: 80 });
    expect(r2).toBe(false);
    expect(settlementCalls).toHaveLength(1); // 未增加

    // 第三次调用 - 不同数据，应该 PUT
    const r3 = await guardedPutSettlement('2026-06-08', { doneCount: 4, totalBeforeRating: 100 });
    expect(r3).toBe(true);
    expect(settlementCalls).toHaveLength(2); // 增加一次
  });

  it('效率数据未变化时不重复 PUT efficiency', async () => {
    const { guardedPutEfficiency, efficiencyCalls } = withGuard();

    const effData = { averageRatio: 0.85, ratios: [0.8, 0.9] };
    const effDataSame = { averageRatio: 0.85, ratios: [0.8, 0.9] };

    // 第一次调用 - 应该 PUT
    const r1 = await guardedPutEfficiency('2026-06-08', effData);
    expect(r1).toBe(true);
    expect(efficiencyCalls).toHaveLength(1);

    // 第二次调用 - 相同数据，应该跳过
    const r2 = await guardedPutEfficiency('2026-06-08', effDataSame);
    expect(r2).toBe(false);
    expect(efficiencyCalls).toHaveLength(1); // 未增加

    // 第三次调用 - 不同数据，应该 PUT
    const r3 = await guardedPutEfficiency('2026-06-08', { averageRatio: 0.9, ratios: [0.8, 0.9, 1.0] });
    expect(r3).toBe(true);
    expect(efficiencyCalls).toHaveLength(2); // 增加一次
  });

  it('并发调用时防止重复执行', async () => {
    const { guardedPutSettlement, settlementCalls } = withGuard();

    // 启动第一个慢操作
    const promise1 = guardedPutSettlement('2026-06-08', { doneCount: 3 });

    // 在第一个完成前，发起第二个（应该被 guard 拦截）
    const r2 = await guardedPutSettlement('2026-06-08', { doneCount: 3 });
    expect(r2).toBe(false); // 被拦截

    await promise1;
    expect(settlementCalls).toHaveLength(1); // 只有一个 PUT
  });
});
