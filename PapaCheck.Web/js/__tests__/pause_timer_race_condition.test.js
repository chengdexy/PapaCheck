/**
 * pause_timer_race_condition.test.js - 暂停计时器竞态条件修复测试（pausedAt 模型）
 *
 * Feature: pollServer 替换 homework 数组时保留暂停状态
 *
 *   Scenario: pollServer 替换 homework 数组时不丢失 paused 标记与 pausedAt
 *     Given 存在一项 doing 状态的作业，且 paused=true（由 pauseActiveTask 设置）并带 pausedAt
 *     When pollServer 从服务端获取到未包含 paused:true 的数据
 *     Then homework 替换后 paused 标记应被保留
 *     And pausedAt 应被保留（用于冻结显示、重载后仍能恢复暂停进度）
 *     And isAnyTaskPaused() 应返回 true
 *
 *   Scenario: 服务端已有 paused:true 时不重复覆盖
 *     Given 存在一项 doing 状态的作业，且 paused=true
 *     When pollServer 从服务端获取到也包含 paused:true 的数据
 *     Then 不覆盖 paused 标记（保持服务端值）
 *
 *   Scenario: 未暂停的作业不受影响
 *     Given 存在一项 doing 状态的作业，且 paused=false
 *     When pollServer 从服务端获取到新数据
 *     Then homework 替换后 paused 仍为 false
 *     And 不注入暂停相关字段
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * 模拟 pollServer 中的 homework 替换逻辑（pausedAt 模型）
 *
 * pollServer 中原本的逻辑：
 *   homeworks = newHw;  // 直接替换，丢失 paused 状态
 *
 * 修复后的逻辑：在替换前捕获旧 active homework 的 paused 状态，
 * 替换后恢复到新对象上。pausedAt 为后端持久化字段，正常轮询服务端直接带出；
 * 此处恢复仅兜住 patch 尚未落库的极短竞态。
 */
function simulatePollServerHomeworkReplacement(oldHomeworks, newHomeworks, withFix = false) {
  // === 修复前逻辑 ===
  if (!withFix) {
    return { homeworks: [...newHomeworks] };
  }

  // === 修复后逻辑（pausedAt 模型）===
  const oldActiveHw = oldHomeworks.find(h => h.status === 'doing');
  const wasLocallyPaused = oldActiveHw && oldActiveHw.paused === true;

  const homeworks = [...newHomeworks];

  if (wasLocallyPaused) {
    const newActive = homeworks.find(h => h.status === 'doing');
    if (newActive && newActive.id === oldActiveHw.id) {
      if (!newActive.paused) {
        newActive.paused = true;
        newActive.wasPaused = true;
      }
      // pausedAt 由本地残留值恢复（仅当服务端尚未携带）
      if (oldActiveHw.pausedAt !== undefined && newActive.pausedAt === undefined) {
        newActive.pausedAt = oldActiveHw.pausedAt;
      }
    }
  }

  return { homeworks };
}

function isAnyTaskPaused(homeworks) {
  const task = homeworks.find(h => h.status === 'doing');
  return task && task.paused;
}

describe('pollServer 替换 homework 时保留暂停状态', () => {

  // Scenario 1: 服务端数据没有 paused:true 时保留本地暂停状态
  it('服务端数据没有 paused:true 时保留本地暂停状态', () => {
    // Given: 旧 homework 含一个 doing+暂停的作业，且本地有 pausedAt
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true, pausedAt: '2026-06-13T10:02:00Z' },
      { id: '2', subject: '语文', content: '作业2', status: 'pending', mode: 'timer' },
    ];

    // When: pollServer 从服务端获取的数据不含 paused 标记
    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z' },
      { id: '2', subject: '语文', content: '作业2', status: 'pending', mode: 'timer' },
    ];

    // 模拟无修复时的替换（BUG 行为）
    const resultWithoutFix = simulatePollServerHomeworkReplacement(oldHw, serverHw, false);

    // Then: paused 标记丢失
    const activeAfterReplace = resultWithoutFix.homeworks.find(h => h.status === 'doing');
    expect(activeAfterReplace.paused).toBeFalsy();
    expect(activeAfterReplace.pausedAt).toBeUndefined();
    expect(isAnyTaskPaused(resultWithoutFix.homeworks)).toBeFalsy();

    // When: 使用修复后逻辑
    const resultWithFix = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);

    // Then: paused 标记被保留
    const activeAfterFix = resultWithFix.homeworks.find(h => h.status === 'doing');
    expect(activeAfterFix.paused).toBe(true);
    expect(activeAfterFix.wasPaused).toBe(true);
    expect(activeAfterFix.pausedAt).toBe('2026-06-13T10:02:00Z');
    expect(isAnyTaskPaused(resultWithFix.homeworks)).toBe(true);
  });

  // Scenario 2: 服务端已有 paused:true 时不重复覆盖
  it('服务端数据已有 paused:true 时不重复覆盖', () => {
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true, pausedAt: '2026-06-13T10:02:00Z' },
    ];

    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true },
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    const active = result.homeworks.find(h => h.status === 'doing');

    // 服务端已带 paused:true 但未带 pausedAt 时，本地残留值被恢复（兜住 patch 未落库竞态）
    expect(active.paused).toBe(true);
    expect(active.pausedAt).toBe('2026-06-13T10:02:00Z');
  });

  // Scenario 3: 未暂停的作业不受影响
  it('未暂停的作业在替换后不受影响', () => {
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z', paused: false },
    ];

    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z' },
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    const active = result.homeworks.find(h => h.status === 'doing');

    // 未暂停的作业不被注入 paused 字段
    expect(active.paused).toBeUndefined();
    expect(active.wasPaused).toBeUndefined();
    expect(active.pausedAt).toBeUndefined();
  });

  // Scenario 4: 无 active homework 时不受影响
  it('没有 active homework 时不受影响', () => {
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'pending' },
    ];
    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'pending' },
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    expect(result.homeworks).toEqual(serverHw);
  });

  // Scenario 5: oldActiveHw 和 newActive 的 id 不同时不恢复（作业已被替换）
  it('active homework 的 id 变化时不恢复旧 paused 状态', () => {
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true, pausedAt: '2026-06-13T10:01:00Z' },
    ];
    const serverHw = [
      { id: '2', subject: '语文', content: '作业2', status: 'doing', mode: 'timer',
        startedAt: '2026-06-13T11:00:00Z' },
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    const active = result.homeworks.find(h => h.status === 'doing');

    // 旧作业（id:1）已经不存在，新作业（id:2）不应该继承暂停状态
    expect(active.paused).toBeFalsy();
    expect(active.pausedAt).toBeUndefined();
  });
});
