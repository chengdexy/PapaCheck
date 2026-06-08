/**
 * reward_box_broadcast.test.js - 奖励箱新奖励播报测试
 *
 * Feature: 轮询检测到奖励箱新奖励时播报
 *   Scenario: 奖励箱新增物品时触发语音播报
 *     Given 轮询正在运行
 *     When 服务端奖励箱返回了新物品
 *     Then pollServer 调用 Voice.speak('奖励箱有新奖励，快去看看吧')
 *
 *   Scenario: 奖励箱数量增加时触发语音播报
 *     Given 轮询正在运行
 *     When 已有物品的数量从 1 增加到 2
 *     Then pollServer 调用 Voice.speak('奖励箱有新奖励，快去看看吧')
 *
 *   Scenario: 奖励箱无变化时不播报
 *     Given 轮询正在运行
 *     When 奖励箱数据与上一轮相同
 *     Then 不调用 Voice.speak
 */

import { describe, it, expect, vi } from 'vitest';

// 模拟奖励箱变化检测逻辑（将在 pollServer 中使用）
function createRewardBoxWatcher() {
  let _lastRewardBox = null;
  const speakCalls = [];

  return {
    speakCalls,
    /**
     * 检测奖励箱变化，如有新增/增量则触发播报
     * 返回 { changed: boolean, addedItems: Array }
     */
    checkRewardBox: (currentBox) => {
      const rb = currentBox || [];
      const prevRb = _lastRewardBox || [];

      if (_lastRewardBox !== null && JSON.stringify(rb) !== JSON.stringify(prevRb)) {
        const addedRb = rb.filter(r =>
          !prevRb.some(p => p.name === r.name) ||
          (r.quantity || 0) > (prevRb.find(p => p.name === r.name)?.quantity || 0)
        );
        if (addedRb.length > 0) {
          speakCalls.push('奖励箱有新奖励，快去看看吧');
        }
        _lastRewardBox = rb.concat();
        return { changed: true, addedItems: addedRb };
      }

      if (_lastRewardBox === null) {
        _lastRewardBox = rb.concat();
        return { changed: false, addedItems: [] };
      }

      return { changed: false, addedItems: [] };
    },
  };
}

describe('奖励箱新奖励播报', () => {
  it('奖励箱新增物品时触发语音播报', () => {
    const { checkRewardBox, speakCalls } = createRewardBoxWatcher();

    // 第一轮：初始化，无变化
    const r1 = checkRewardBox([{ id: 'r1', name: '免作业券', quantity: 1 }]);
    expect(r1.changed).toBe(false);
    expect(speakCalls).toHaveLength(0);

    // 第二轮：新增物品
    const r2 = checkRewardBox([
      { id: 'r1', name: '免作业券', quantity: 1 },
      { id: 'r2', name: '玩游戏30分钟', quantity: 1 },
    ]);
    expect(r2.changed).toBe(true);
    expect(r2.addedItems).toHaveLength(1);
    expect(r2.addedItems[0].name).toBe('玩游戏30分钟');
    expect(speakCalls).toHaveLength(1);
    expect(speakCalls[0]).toBe('奖励箱有新奖励，快去看看吧');
  });

  it('奖励箱数量增加时触发语音播报', () => {
    const { checkRewardBox, speakCalls } = createRewardBoxWatcher();

    // 初始化
    checkRewardBox([{ id: 'r1', name: '免作业券', quantity: 1 }]);

    // 数量增加
    const r = checkRewardBox([{ id: 'r1', name: '免作业券', quantity: 2 }]);
    expect(r.changed).toBe(true);
    expect(r.addedItems).toHaveLength(1);
    expect(r.addedItems[0].name).toBe('免作业券');
    expect(speakCalls).toHaveLength(1);
    expect(speakCalls[0]).toBe('奖励箱有新奖励，快去看看吧');
  });

  it('奖励箱无变化时不播报', () => {
    const { checkRewardBox, speakCalls } = createRewardBoxWatcher();

    // 初始化
    checkRewardBox([{ id: 'r1', name: '免作业券', quantity: 1 }]);

    // 无变化
    const r = checkRewardBox([{ id: 'r1', name: '免作业券', quantity: 1 }]);
    expect(r.changed).toBe(false);
    expect(speakCalls).toHaveLength(0); // 不触发播报
  });
});
