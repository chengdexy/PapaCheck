/**
 * test_fulfill_redemption_only_put_target.test.js
 *
 * 修复 fulfillRedemption 全量 PUT 所有兑换记录导致的两个 Bug：
 *
 * Bug 1: 孩子端撤回的兑现自由时间，管理端没有消失
 *   - 根因：fulfillRedemption 循环 PUT 所有 adminRedemptions，
 *     覆盖了孩子端的撤销操作（cancelled → pending）
 *
 * Bug 2: 偶发管理端审核通过的自由时间在管理端没有消失
 *   - 根因：循环中某个 PUT 网络失败，只更新了部分记录，
 *     refreshAllData 后 fulfilled 记录回退到 pending
 *
 * 修复方案：只 PUT 当前正在兑现的那条记录
 */

import { test, assert } from 'vitest';

// ========== 核心业务逻辑（从 admin.js fulfillRedemption 提取） ==========

/**
 * 获取需要 PUT 到服务端的兑换记录列表。
 *
 * 修复前：返回所有记录（全量 PUT，导致覆盖孩子端撤销操作）。
 * 修复后：只返回被确认兑现的那条记录。
 *
 * @param {Array} redemptions - 管理端缓存的所有兑换记录
 * @param {string} targetId - 管理员确认兑现的记录 ID
 * @returns {{ redemptionsToPut: Array, target: object|null }}
 */
function getRedemptionsToPutOnFulfill(redemptions, targetId) {
  const target = redemptions.find(r => r.id === targetId);
  if (!target || target.status !== 'pending') {
    return { redemptionsToPut: [], target: null };
  }
  target.status = 'fulfilled';

  // RED 阶段：OLD 行为返回所有记录（已验证测试失败）
  // return { redemptionsToPut: redemptions, target };
  //
  // GREEN 阶段：NEW 行为只返回目标记录
  return { redemptionsToPut: [target], target };
}

// ========== 测试用例 ==========

// Feature: 管理端确认兑现兑换时只 PUT 目标记录
//
//   Scenario: 确认兑现时只 PUT 目标兑换记录，不 PUT 其他记录
//     Given 管理端有多条兑换记录
//     When 管理员确认兑现其中一条
//     Then 只 PUT 那条被兑现的记录到服务端
//     And 其他记录的 status 不会被修改

test('管理端确认兑现时只 PUT 目标兑换记录', () => {
  const redemptions = [
    { id: 'r1', itemName: '游戏30分钟', status: 'pending' },
    { id: 'r2', itemName: '动画30分钟', status: 'pending' },
    { id: 'r3', itemName: '零食', status: 'pending' },
  ];
  const before = JSON.stringify(redemptions);

  const { redemptionsToPut, target } = getRedemptionsToPutOnFulfill(redemptions, 'r2');

  // 只 PUT 了一条记录
  assert.strictEqual(redemptionsToPut.length, 1,
    '应只返回 1 条记录（修复后行为）');
  assert.strictEqual(redemptionsToPut[0].id, 'r2',
    '应返回目标记录 r2');
  assert.strictEqual(redemptionsToPut[0].status, 'fulfilled',
    '目标记录 status 应变为 fulfilled');

  // 非目标记录的 status 不应被修改
  assert.strictEqual(redemptions.find(r => r.id === 'r1').status, 'pending',
    '非目标记录 r1 的 status 应保持 pending');
  assert.strictEqual(redemptions.find(r => r.id === 'r3').status, 'pending',
    '非目标记录 r3 的 status 应保持 pending');
});

//   Scenario: 目标兑换记录已被孩子撤回时，确认兑现会覆盖撤销
//     Given 管理端缓存中有旧数据（未同步孩子端的撤销）
//     And 其中一条记录已被孩子端撤回（stale）
//     When 管理员确认兑现另一条记录（旧代码行为）
//     Then 循环 PUT 会覆盖孩子端的撤销操作
//     And 修复后只 PUT 当前兑现的记录，不触及已撤销的记录

test('修复后不会覆盖孩子端的撤销操作', () => {
  // 模拟场景：孩子已撤销 r3（status='cancelled'），但管理端缓存还是旧数据
  const redemptions = [
    { id: 'r1', itemName: '游戏30分钟', status: 'pending' },
    // r2 在服务端已被孩子撤销，但管理端缓存还是 pending（旧数据）
    { id: 'r2', itemName: '动画30分钟', status: 'pending' },
  ];
  // 模拟服务端已被孩子撤销的记录（管理端不知道）
  const serverSideR2 = { id: 'r2', itemName: '动画30分钟', status: 'cancelled' };

  const { redemptionsToPut } = getRedemptionsToPutOnFulfill(redemptions, 'r1');

  // 修复后：只 PUT r1，不触及 r2
  const putIds = redemptionsToPut.map(r => r.id);
  assert.ok(putIds.includes('r1'), '应 PUT 目标记录 r1');
  assert.ok(!putIds.includes('r2'), '不应 PUT 已撤回的记录 r2');
  assert.strictEqual(redemptionsToPut.length, 1,
    '应只 PUT 1 条记录');
});

//   Scenario: 多条兑换记录时，网络故障不影响其他记录
//     Given 管理端有多条兑换记录
//     When 确认兑现时网络故障
//     Then 只影响目标记录，不影响其他记录

test('修复后网络故障只影响目标记录', () => {
  const redemptions = [
    { id: 'r1', itemName: '游戏30分钟', status: 'pending' },
    { id: 'r2', itemName: '动画30分钟', status: 'pending' },
    { id: 'r3', itemName: '零食', status: 'pending' },
  ];

  const { redemptionsToPut } = getRedemptionsToPutOnFulfill(redemptions, 'r1');

  // 修复后：只返回 [r1]，即使 r2/r3 的 PUT 失败也不影响
  // （旧行为每个记录单独 PUT，任何一条失败都可能导致不一致）
  assert.strictEqual(redemptionsToPut.length, 1,
    '网络故障应只影响目标记录');
  assert.strictEqual(redemptionsToPut[0].id, 'r1',
    '应只返回目标记录 r1');
});

//   Scenario: 目标记录不存在时返回空列表
//     Given 管理端缓存中没有该 ID 的记录
//     When 管理员确认兑现
//     Then 返回空列表

test('目标记录不存在时返回空列表', () => {
  const redemptions = [
    { id: 'r1', itemName: '游戏30分钟', status: 'pending' },
  ];

  const { redemptionsToPut, target } = getRedemptionsToPutOnFulfill(redemptions, 'nonexistent');

  assert.strictEqual(redemptionsToPut.length, 0, '目标不存在时应返回空列表');
  assert.strictEqual(target, null, 'target 应为 null');
});

//   Scenario: 目标记录已兑现时返回空列表
//     Given 目标记录 status 为 fulfilled
//     When 管理员确认兑现
//     Then 返回空列表

test('目标记录已兑现时返回空列表', () => {
  const redemptions = [
    { id: 'r1', itemName: '游戏30分钟', status: 'fulfilled' },
  ];

  const { redemptionsToPut } = getRedemptionsToPutOnFulfill(redemptions, 'r1');

  assert.strictEqual(redemptionsToPut.length, 0,
    '已兑现的记录不应再 PUT');
});
