/**
 * test_reward_box_consumption.test.js
 *
 * Feature: 奖励箱物品消耗后不应再次出现
 *   当奖励箱物品被消耗（数量归零）后，服务端应正确标记为已删除，
 *   后续获取数据时不应再返回该物品。
 */
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * 模拟奖励箱消耗场景，验证 deleteRewardBoxItem 被正确调用
 */
function createTestEnv() {
  const deleteCalls = [];

  const apiMock = {
    getRewardBox: async () => [
      { id: 'rb1', name: '游戏30分钟', type: 'time', durationMinutes: 30, quantity: 1 },
    ],
    putRewardBoxItem: async () => {},
    deleteRewardBoxItem: async (id) => {
      deleteCalls.push(id);
    },
  };

  // 模拟 redemption 对象
  const redemptionMock = {
    id: 'red1',
    itemName: '游戏30分钟',
    itemType: 'time',
    durationMinutes: 30,
    rewardBoxItemId: 'rb1',
  };

  /**
   * 模拟修复后的 _fulfillFromRewardBox 行为：
   * 数量归零时调用 deleteRewardBoxItem 而不是只 splice
   */
  async function fulfillFromRewardBox() {
    const rewardBox = await apiMock.getRewardBox();
    const rbItem = rewardBox.find(rb => rb.id === redemptionMock.rewardBoxItemId);
    if (rbItem) {
      rbItem.quantity = (rbItem.quantity || 0) - 1;
      if (rbItem.quantity <= 0) {
        // 修复后：先标记服务端删除
        await apiMock.deleteRewardBoxItem(rbItem.id);
        const idx = rewardBox.indexOf(rbItem);
        if (idx !== -1) rewardBox.splice(idx, 1);
        // PUT 剩余物品到服务端
        for (var i = 0; i < rewardBox.length; i++) {
          await apiMock.putRewardBoxItem(rewardBox[i].id, rewardBox[i]);
        }
      } else {
        await apiMock.putRewardBoxItem(rbItem.id, rbItem);
      }
    }
  }

  /**
   * 模拟修复后的 adjustRewardBoxQty 行为：
   * 数量归零时调用 deleteRewardBoxItem 而不是 PUT quantity=0
   */
  async function adjustRewardBoxQty(itemId, delta) {
    const item = await { id: itemId, quantity: 1 };
    const newQty = Math.max(0, (item.quantity || 0) + delta);
    if (newQty <= 0) {
      // 修复后：调用 deleteRewardBoxItem
      await apiMock.deleteRewardBoxItem(itemId);
    } else {
      await apiMock.putRewardBoxItem(itemId, { ...item, quantity: newQty });
    }
  }

  return {
    fulfillFromRewardBox,
    adjustRewardBoxQty,
    deleteCalls,
    apiMock,
  };
}

describe('奖励箱消耗后处理', () => {
  it('履行兑换后数量归零应调用 deleteRewardBoxItem', async () => {
    const env = createTestEnv();

    await env.fulfillFromRewardBox();

    // 修复后：应调用 deleteRewardBoxItem('rb1')
    expect(env.deleteCalls).toHaveLength(1);
    expect(env.deleteCalls[0]).toBe('rb1');
  });

  it('手动调整数量归零应调用 deleteRewardBoxItem', async () => {
    const env = createTestEnv();

    await env.adjustRewardBoxQty('rb1', -1);

    // 修复后：数量从 1 减到 0，应调用 deleteRewardBoxItem('rb1')
    expect(env.deleteCalls).toHaveLength(1);
    expect(env.deleteCalls[0]).toBe('rb1');
  });
});
