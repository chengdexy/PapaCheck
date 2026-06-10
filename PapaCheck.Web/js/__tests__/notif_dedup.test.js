/**
 * notif_dedup.test.js - "收到新作业"通知去重合并测试
 *
 * Feature: 作业通知去重
 *   Scenario: 多条"收到新作业"去重
 *     Given items 包含多条 text 为 "收到新作业，请查看" 的通知
 *     When 调用 dedupNewHomeworkNotifications(items)
 *     Then 返回的数组中只保留最后一条 "收到新作业"
 *
 *   Scenario: 仅一条"收到新作业"保留不变
 *     Given items 仅包含一条 "收到新作业，请查看"
 *     When 调用 dedupNewHomeworkNotifications(items)
 *     Then 结果不变
 *
 *   Scenario: 无"收到新作业"保留不变
 *     Given items 不包含 "收到新作业，请查看"
 *     When 调用 dedupNewHomeworkNotifications(items)
 *     Then 结果不变
 *
 *   Scenario: 混合其他通知，仅"收到新作业"去重
 *     Given items 包含多种通知文本
 *     When 调用 dedupNewHomeworkNotifications(items)
 *     Then 仅"收到新作业"被去重，其他通知保持不变
 *
 *   Scenario: 空数组返回空数组
 *     Given items 为空数组
 *     When 调用 dedupNewHomeworkNotifications(items)
 *     Then 返回空数组
 */

import { describe, it, expect } from 'vitest';

/**
 * 对"收到新作业，请查看"通知去重：多条同文本只保留最后一条
 */
function dedupNewHomeworkNotifications(items) {
  const SEEN_TEXT = '收到新作业，请查看';
  let found = false;
  const result = [];
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].text === SEEN_TEXT) {
      if (found) continue;
      found = true;
    }
    result.unshift(items[i]);
  }
  return result;
}

describe('dedupNewHomeworkNotifications', () => {
  it('多条"收到新作业"去重，只保留最后一条', () => {
    const items = [
      { id: '1', text: '收到新作业，请查看' },
      { id: '2', text: '奖励箱上新' },
      { id: '3', text: '收到新作业，请查看' },
      { id: '4', text: '收到新作业，请查看' },
    ];
    const result = dedupNewHomeworkNotifications(items);
    expect(result).toEqual([
      { id: '2', text: '奖励箱上新' },
      { id: '4', text: '收到新作业，请查看' },
    ]);
  });

  it('仅一条"收到新作业"保留不变', () => {
    const items = [
      { id: '1', text: '奖励箱上新' },
      { id: '2', text: '收到新作业，请查看' },
    ];
    const result = dedupNewHomeworkNotifications(items);
    expect(result).toEqual(items);
  });

  it('无"收到新作业"保留不变', () => {
    const items = [
      { id: '1', text: '奖励箱上新' },
      { id: '2', text: '作业被驳回' },
    ];
    const result = dedupNewHomeworkNotifications(items);
    expect(result).toEqual(items);
  });

  it('混合其他通知，仅"收到新作业"去重', () => {
    const items = [
      { id: '1', text: '奖励箱上新' },
      { id: '2', text: '收到新作业，请查看' },
      { id: '3', text: '作业被驳回' },
      { id: '4', text: '收到新作业，请查看' },
      { id: '5', text: '积分商店上新' },
      { id: '6', text: '收到新作业，请查看' },
    ];
    const result = dedupNewHomeworkNotifications(items);
    expect(result).toEqual([
      { id: '1', text: '奖励箱上新' },
      { id: '3', text: '作业被驳回' },
      { id: '5', text: '积分商店上新' },
      { id: '6', text: '收到新作业，请查看' },
    ]);
  });

  it('空数组返回空数组', () => {
    expect(dedupNewHomeworkNotifications([])).toEqual([]);
  });
});
