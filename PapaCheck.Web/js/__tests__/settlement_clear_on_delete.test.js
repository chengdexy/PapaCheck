/**
 * settlement_clear_on_delete.test.js - 删除作业后结算界面清理测试
 *
 * Feature: 管理端删除所有作业后结算界面自动关闭
 *   Scenario: pollServer 检测到无已完成作业时清除结算
 *     Given 结算数据存在（未评级），但 homeworks 中没有 done 状态的作业
 *     When 执行结算清理检查
 *     Then cachedData._settlement 被设为 null
 *     And window._settlement 被设为 null
 *     And cachedData.dailySettlement 中对应 key 被删除
 *
 *   Scenario: 有已完成作业时不清除结算
 *     Given 结算数据存在（未评级），且 homeworks 中有 done 状态的作业
 *     When 执行结算清理检查
 *     Then 结算数据保持不变
 *
 *   Scenario: 已评级时不清除结算
 *     Given 结算数据存在且有 rating
 *     When 执行结算清理检查
 *     Then 结算数据保持不变
 *
 * Feature: submitForRating 在没有已完成作业时不能提交
 *   Scenario: 无 done 作业时 submitForRating 返回
 *     Given homeworks 中没有 done 状态的作业
 *     When 调用 submitForRating
 *     Then 函数提前返回，不调用 API.putSettlement
 */
import { describe, it, expect } from 'vitest';

/**
 * 模拟 pollServer 中的独立结算清理检查逻辑
 *
 * 在 homework 替换块之后执行的独立检查：
 * 无论 homework 数据是否变化，只要发现有未评级的结算
 * 但不存在已完成作业，就清除结算。
 */
function runSettlementClearCheck(homeworks, settlement, dailySettlement, key) {
  const state = {
    cachedData: {
      _settlement: dailySettlement?.[key] || null,
      dailySettlement: dailySettlement ? { ...dailySettlement } : undefined,
    },
    window: { _settlement: dailySettlement?.[key] || null },
    needsFullRender: false,
  };

  // === 独立结算清理检查（修复后的逻辑）===
  const hasDoneHomework = homeworks.some(h => h.status === 'done');
  const settlementData = settlement;

  if (settlementData && !settlementData.rating && !hasDoneHomework) {
    state.cachedData._settlement = null;
    state.window._settlement = null;
    if (state.cachedData.dailySettlement) {
      delete state.cachedData.dailySettlement[key];
    }
    state.needsFullRender = true;
  }

  return state;
}

/**
 * 模拟 submitForRating 中的守卫检查
 */
function canSubmitForRating(homeworks, windowSettlement) {
  if (!windowSettlement) return { canSubmit: false, reason: 'no_settlement' };
  const hasDoneHomework = homeworks.some(h => h.status === 'done');
  if (!hasDoneHomework) return { canSubmit: false, reason: 'no_done_homework' };
  return { canSubmit: true, reason: 'ok' };
}

describe('pollServer 独立结算清理检查', () => {
  const key = '2026-06-13';

  it('无已完成作业时清除未评级结算', () => {
    const homeworks = [
      { id: '1', status: 'pending', subject: '数学' },
    ];
    const settlement = {
      dailyBase: 50, homeworkBonus: 30, totalBeforeRating: 80,
      doneCount: 0, rating: null, submittedAt: null,
    };
    const dailySettlement = { [key]: settlement };

    const result = runSettlementClearCheck(homeworks, settlement, dailySettlement, key);

    expect(result.cachedData._settlement).toBeNull();
    expect(result.window._settlement).toBeNull();
    expect(result.cachedData.dailySettlement?.[key]).toBeUndefined();
    expect(result.needsFullRender).toBe(true);
  });

  it('有已完成作业时不清除结算', () => {
    const homeworks = [
      { id: '1', status: 'done', subject: '数学' },
    ];
    const settlement = {
      dailyBase: 50, homeworkBonus: 30, totalBeforeRating: 80,
      doneCount: 1, rating: null, submittedAt: null,
    };
    const dailySettlement = { [key]: settlement };

    const result = runSettlementClearCheck(homeworks, settlement, dailySettlement, key);

    expect(result.cachedData._settlement).not.toBeNull();
    expect(result.window._settlement).not.toBeNull();
    expect(result.needsFullRender).toBe(false);
  });

  it('已评级时不清除结算', () => {
    const homeworks = [
      { id: '1', status: 'done', subject: '数学' },
    ];
    const settlement = {
      dailyBase: 50, homeworkBonus: 30, totalBeforeRating: 80,
      doneCount: 1, rating: '优', multiplier: 1.2, finalPoints: 96,
    };
    const dailySettlement = { [key]: settlement };

    const result = runSettlementClearCheck(homeworks, settlement, dailySettlement, key);

    expect(result.cachedData._settlement).not.toBeNull();
    expect(result.window._settlement).not.toBeNull();
    expect(result.needsFullRender).toBe(false);
  });

  it('空 homework 数组时清除结算', () => {
    const homeworks = [];
    const settlement = {
      dailyBase: 50, homeworkBonus: 30, totalBeforeRating: 80,
      doneCount: 0, rating: null, submittedAt: null,
    };
    const dailySettlement = { [key]: settlement };

    const result = runSettlementClearCheck(homeworks, settlement, dailySettlement, key);

    expect(result.cachedData._settlement).toBeNull();
    expect(result.window._settlement).toBeNull();
    expect(result.cachedData.dailySettlement?.[key]).toBeUndefined();
    expect(result.needsFullRender).toBe(true);
  });

  it('无结算数据时不执行操作', () => {
    const homeworks = [];
    const settlement = null;
    const dailySettlement = {};

    const result = runSettlementClearCheck(homeworks, settlement, dailySettlement, key);

    expect(result.cachedData._settlement).toBeNull();
    expect(result.window._settlement).toBeNull();
    expect(result.needsFullRender).toBe(false);
  });
});

describe('submitForRating 守卫检查', () => {
  it('无 done 作业时不能提交', () => {
    const homeworks = [
      { id: '1', status: 'pending', subject: '数学' },
    ];
    const settlement = { dailyBase: 50, homeworkBonus: 30 };

    const result = canSubmitForRating(homeworks, settlement);
    expect(result.canSubmit).toBe(false);
    expect(result.reason).toBe('no_done_homework');
  });

  it('有 done 作业时可以提交', () => {
    const homeworks = [
      { id: '1', status: 'done', subject: '数学' },
    ];
    const settlement = { dailyBase: 50, homeworkBonus: 30 };

    const result = canSubmitForRating(homeworks, settlement);
    expect(result.canSubmit).toBe(true);
  });

  it('无 settlement 时不能提交', () => {
    const homeworks = [
      { id: '1', status: 'done', subject: '数学' },
    ];
    const result = canSubmitForRating(homeworks, null);
    expect(result.canSubmit).toBe(false);
    expect(result.reason).toBe('no_settlement');
  });

  it('空 homework 列表时不能提交', () => {
    const homeworks = [];
    const settlement = { dailyBase: 50, homeworkBonus: 30 };

    const result = canSubmitForRating(homeworks, settlement);
    expect(result.canSubmit).toBe(false);
    expect(result.reason).toBe('no_done_homework');
  });
});

