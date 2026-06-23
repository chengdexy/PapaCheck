/**
 * test_admin_add_homework_preserves_rating.js
 * 管理端新增作业时保护已有评级不被清除
 *
 * 测试 admin.js 中 saveAdminHw() 的核心逻辑：
 * 新增作业时仅当 settlement 无评级才清空
 */

import { test, assert } from 'vitest';

// ========== 修正后的 save 逻辑（可测试版本） ==========

function shouldClearSettlementOnAddHomework({ isEditing, cachedData, dateKey }) {
    // 编辑已有作业：不清除 settlement
    if (isEditing) return false;

    // 新增作业：仅当 settlement 无评级或不存在时才清除
    const existingSettlement = cachedData?.dailySettlement?.[dateKey];
    if (existingSettlement && existingSettlement.rating) {
        return false; // 已有评级，不清除
    }
    return true; // 无评级或 settlement 不存在，清除
}

// ========== 测试用例 ==========

// Feature: 管理端新增作业时保护已有评级
//
//   Scenario: 管理端新增作业不清除已有评级的 settlement
//     Given 当天已有 settlement，rating='优', multiplier=2.0
//     When 管理端新增一项作业（isEditing=false）
//     Then 不应清除 settlement（返回 false）

test('管理端新增作业不清除已有评级的 settlement', () => {
    const dateKey = '2026-06-04';
    const cachedData = {
        dailySettlement: {
            [dateKey]: {
                dailyBase: 50,
                homeworkBonus: 10,
                totalBeforeRating: 60,
                doneCount: 1,
                rating: '优',
                multiplier: 2.0,
                finalPoints: 120,
                submittedAt: '18:30',
                ratedAt: '19:00',
                viewedAt: '19:05',
            },
        },
    };

    const result = shouldClearSettlementOnAddHomework({
        isEditing: false,
        cachedData,
        dateKey,
    });

    assert.strictEqual(result, false, '已有评级时不应清除 settlement');
});

//   Scenario: 管理端新增作业时如果未评级则照常清空 settlement
//     Given 当天 settlement 不存在
//     When 管理端新增一项作业（isEditing=false）
//     Then 应清除 settlement（返回 true）

test('管理端新增作业时如果未评级则照常清空 settlement（settlement 不存在）', () => {
    const dateKey = '2026-06-04';
    const cachedData = {
        dailySettlement: {},
    };

    const result = shouldClearSettlementOnAddHomework({
        isEditing: false,
        cachedData,
        dateKey,
    });

    assert.strictEqual(result, true, '未评级时应清除 settlement');
});

//   Scenario: settlement 存在但 rating 为 null 时清除
//     Given 当天 settlement 存在但 rating 为 null
//     When 管理端新增一项作业
//     Then 应清除 settlement

test('管理端新增作业时如果 settlement 无评级则清除', () => {
    const dateKey = '2026-06-04';
    const cachedData = {
        dailySettlement: {
            [dateKey]: {
                dailyBase: 50,
                homeworkBonus: 10,
                rating: null,
                multiplier: null,
            },
        },
    };

    const result = shouldClearSettlementOnAddHomework({
        isEditing: false,
        cachedData,
        dateKey,
    });

    assert.strictEqual(result, true, 'settlement 无评级时应清除');
});

//   Scenario: 管理端编辑已有作业不清除 settlement
//     Given 当天已有 settlement，rating='优'
//     When 管理端编辑一项作业（isEditing=true）
//     Then 不清除 settlement（返回 false）

test('管理端编辑已有作业不清除 settlement', () => {
    const dateKey = '2026-06-04';
    const cachedData = {
        dailySettlement: {
            [dateKey]: {
                rating: '优',
                multiplier: 2.0,
                finalPoints: 120,
            },
        },
    };

    const result = shouldClearSettlementOnAddHomework({
        isEditing: true,
        cachedData,
        dateKey,
    });

    assert.strictEqual(result, false, '编辑模式不应清除 settlement');
});

//   Scenario: cachedData 不存在时照常清除
//     Given cachedData 为 null
//     When 管理端新增一项作业
//     Then 应清除 settlement

test('cachedData 不存在时照常清除 settlement', () => {
    const dateKey = '2026-06-04';

    const result = shouldClearSettlementOnAddHomework({
        isEditing: false,
        cachedData: null,
        dateKey,
    });

    assert.strictEqual(result, true, 'cachedData 为 null 时应清除');
});

//   Scenario: dailySettlement 不存在时照常清除
//     Given cachedData.dailySettlement 为 undefined
//     When 管理端新增一项作业
//     Then 应清除 settlement

test('dailySettlement 不存在时照常清除 settlement', () => {
    const dateKey = '2026-06-04';
    const cachedData = {};

    const result = shouldClearSettlementOnAddHomework({
        isEditing: false,
        cachedData,
        dateKey,
    });

    assert.strictEqual(result, true, 'dailySettlement 不存在时应清除');
});

//   Scenario: 评分为'差'时也不应清除（已评级就是已评级）
//     Given 当天已有 settlement，rating='差'
//     When 管理端新增一项作业
//     Then 不应清除 settlement

test('评分为差时也不应清除 settlement', () => {
    const dateKey = '2026-06-04';
    const cachedData = {
        dailySettlement: {
            [dateKey]: {
                rating: '差',
                multiplier: 0,
                finalPoints: 0,
            },
        },
    };

    const result = shouldClearSettlementOnAddHomework({
        isEditing: false,
        cachedData,
        dateKey,
    });

    assert.strictEqual(result, false, '评分为差时也不应清除（已评级）');
});
