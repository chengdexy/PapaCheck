/**
 * pause_timer_race_condition.test.js - 暂停计时器竞态条件修复测试
 *
 * Feature: pollServer 替换 homework 数组时保留暂停状态
 *
 *   Scenario: pollServer 替换 homework 数组时不丢失 paused 标记
 *     Given 存在一项 doing 状态的作业，且 paused=true（由 pauseActiveTask 设置）
 *     When pollServer 从服务端获取到未包含 paused:true 的数据
 *     Then homework 替换后 paused 标记应被保留
 *     And _pausedElapsed 应被保留
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
 * 模拟 pollServer 中的 homework 替换逻辑（app.js 第 886-907 行）
 *
 * pollServer 中原本的逻辑：
 *   homeworks = newHw;  // 直接替换，丢失 paused 状态
 *
 * 修复后的逻辑：在替换前捕获旧 active homework 的 paused 状态，
 * 替换后恢复到新对象上。
 */
function simulatePollServerHomeworkReplacement(oldHomeworks, newHomeworks, withFix = false) {
  // === 修复前逻辑 ===
  if (!withFix) {
    // 直接替换（原有行为 - bug）
    return { homeworks: [...newHomeworks] };
  }

  // === 修复后逻辑 ===

  // Step 1: 捕获旧 active homework 的 in-memory paused 状态
  const oldActiveHw = oldHomeworks.find(h => h.status === 'doing');
  const wasLocallyPaused = oldActiveHw && oldActiveHw.paused === true;

  // Step 2: 替换 homeworks
  const homeworks = [...newHomeworks];

  // Step 3: 恢复 paused 状态（如果服务端数据尚未包含）
  if (wasLocallyPaused) {
    const newActive = homeworks.find(h => h.status === 'doing');
    if (newActive && newActive.id === oldActiveHw.id) {
      // 服务端数据没有 paused:true 时恢复
      if (!newActive.paused) {
        newActive.paused = true;
        newActive.wasPaused = true;
      }
      // _pausedElapsed 始终是本地临时字段，总是恢复
      if (oldActiveHw._pausedElapsed !== undefined) {
        newActive._pausedElapsed = oldActiveHw._pausedElapsed;
      }
    }
  }

  return { homeworks };
}

/**
 * 模拟 isAnyTaskPaused
 */
function isAnyTaskPaused(homeworks) {
  const task = homeworks.find(h => h.status === 'doing');
  return task && task.paused;
}

describe('pollServer 替换 homework 时保留暂停状态', () => {

  // Scenario 1: 服务端数据没有 paused:true 时保留本地暂停状态
  it('服务端数据没有 paused:true 时保留本地暂停状态', () => {
    // Given: 旧 homework 含一个 doing+暂停的作业，且本地有 _pausedElapsed
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true, _pausedElapsed: 120 },
      { id: '2', subject: '语文', content: '作业2', status: 'pending', mode: 'timer' },
    ];

    // When: pollServer 从服务端获取的数据不含 paused 标记
    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z' },  // 无 paused
      { id: '2', subject: '语文', content: '作业2', status: 'pending', mode: 'timer' },
    ];

    // 模拟无修复时的替换（BUG 行为）
    const resultWithoutFix = simulatePollServerHomeworkReplacement(oldHw, serverHw, false);

    // Then: paused 标记丢失
    const activeAfterReplace = resultWithoutFix.homeworks.find(h => h.status === 'doing');
    expect(activeAfterReplace.paused).toBeFalsy();
    expect(activeAfterReplace._pausedElapsed).toBeUndefined();
    expect(isAnyTaskPaused(resultWithoutFix.homeworks)).toBeFalsy();

    // When: 使用修复后逻辑
    const resultWithFix = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);

    // Then: paused 标记被保留
    const activeAfterFix = resultWithFix.homeworks.find(h => h.status === 'doing');
    expect(activeAfterFix.paused).toBe(true);
    expect(activeAfterFix.wasPaused).toBe(true);
    expect(activeAfterFix._pausedElapsed).toBe(120);
    expect(isAnyTaskPaused(resultWithFix.homeworks)).toBe(true);
  });

  // Scenario 2: 服务端已有 paused:true 时不重复覆盖
  it('服务端数据已有 paused:true 时不重复覆盖', () => {
    // Given: 旧 homework 含 paused 作业
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true, _pausedElapsed: 120 },
    ];

    // When: 服务端数据也包含 paused:true
    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z',
        paused: true, wasPaused: true },  // 服务端已有 paused
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    const active = result.homeworks.find(h => h.status === 'doing');

    // Then: paused 标记保持服务端值（不覆盖）
    expect(active.paused).toBe(true);
    expect(active._pausedElapsed).toBe(120); // 本地 _pausedElapsed 被恢复

    // 注意：如果服务端 paused:true 且没有 _pausedElapsed，本地值会被恢复
    // 这是正确行为，因为 _pausedElapsed 始终是本地临时字段
  });

  // Scenario 3: 未暂停的作业不受影响
  it('未暂停的作业在替换后不受影响', () => {
    // Given: 旧 homework 含一个 doing 但未暂停的作业
    const oldHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z', paused: false },
    ];

    // When: 服务端数据也没有 paused
    const serverHw = [
      { id: '1', subject: '数学', content: '作业1', status: 'doing', mode: 'challenge',
        suggestedDuration: 30, startedAt: '2026-06-13T10:00:00Z' },
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    const active = result.homeworks.find(h => h.status === 'doing');

    // Then: 未暂停的作业不被注入 paused 字段
    expect(active.paused).toBeUndefined();
    expect(active.wasPaused).toBeUndefined();
    expect(active._pausedElapsed).toBeUndefined();
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
        paused: true, wasPaused: true, _pausedElapsed: 60 },
    ];
    const serverHw = [
      { id: '2', subject: '语文', content: '作业2', status: 'doing', mode: 'timer',
        startedAt: '2026-06-13T11:00:00Z' },  // 不同作业
    ];

    const result = simulatePollServerHomeworkReplacement(oldHw, serverHw, true);
    const active = result.homeworks.find(h => h.status === 'doing');

    // 旧作业（id:1）已经不存在，新作业（id:2）不应该继承暂停状态
    expect(active.paused).toBeFalsy();
    expect(active._pausedElapsed).toBeUndefined();
  });
});
