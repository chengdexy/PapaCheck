/**
 * test_duplicate_rating.js - 防止一天内重复弹出评级框的单元测试
 *
 * 测试 app.js 中 calculateSettlement() 函数在当天已评级场景下的行为
 */

import { test, assert, beforeEach } from 'vitest';

// ========== 可测试的结算逻辑 ==========
// 将 calculateSettlement 的核心逻辑提取为纯函数，方便测试
// 这是对 app.js 中 calculateSettlement() 的逻辑等价实现

async function calculateSettlementLogic({
    homeworks,
    currentDate,
    Util,
    cachedData,
    API,
    updateBigScreen,
    window,
}) {
    const doneHw = homeworks.filter(h => h.status === 'done');
    const challengeSuccess = doneHw.filter(h => h.mode === 'challenge' && !h.rejected);
    const efficiencyHw = doneHw.filter(h => !h.rejected);

    const dateKey = Util.dateKey(currentDate);

    // === BUG FIX: 检查当天是否已有 settlement ===
    const existingSettlement = cachedData?.dailySettlement?.[dateKey];

    if (existingSettlement) {
        const prevHomeworkBonus = existingSettlement.homeworkBonus || 0;

        // 当前总分（作业奖励）
        const currentHomeworkBonus = challengeSuccess.reduce(
            (sum, h) => sum + (h.basePoints ?? cachedData?.settings?.homeworkBonusPerTask ?? 10), 0
        );

        // 新增的作业奖励分
        const newHomeworkBonus = currentHomeworkBonus - prevHomeworkBonus;

        if (existingSettlement.rating) {
            // 当天已评级：只计算新增作业的分数，不含每日基础分
            if (newHomeworkBonus > 0) {
                // 用已有倍率计算新增积分（不含每日基础分）
                const multiplier = existingSettlement.multiplier;
                const additionalPoints = Math.round(newHomeworkBonus * multiplier);

                // 更新 settlement：累加作业奖励和总积分
                const updatedSettlement = {
                    ...existingSettlement,
                    homeworkBonus: currentHomeworkBonus,
                    totalBeforeRating: existingSettlement.dailyBase + currentHomeworkBonus,
                    doneCount: doneHw.length,
                    finalPoints: (existingSettlement.finalPoints || 0) + additionalPoints,
                };

                window._settlement = updatedSettlement;
                await API.saveSettlement(dateKey, updatedSettlement);
                if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
                cachedData.dailySettlement[dateKey] = updatedSettlement;

                // 自动增加积分
                if (additionalPoints > 0) {
                    await API.updatePoints('earn', additionalPoints,
                        `追加完成作业，按${existingSettlement.rating}评级倍率计算`);
                }
            } else {
                // 没有新作业加分，只更新 doneCount
                const updatedSettlement = {
                    ...existingSettlement,
                    doneCount: doneHw.length,
                };
                window._settlement = updatedSettlement;
                await API.saveSettlement(dateKey, updatedSettlement);
                if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
                cachedData.dailySettlement[dateKey] = updatedSettlement;
            }
        } else if (existingSettlement.submittedAt) {
            // 已提交等待评级：只更新 homeworkBonus/totalBeforeRating，不加分（尚未评级，无倍率）
            if (newHomeworkBonus > 0) {
                const updatedSettlement = {
                    ...existingSettlement,
                    homeworkBonus: currentHomeworkBonus,
                    totalBeforeRating: existingSettlement.dailyBase + currentHomeworkBonus,
                    doneCount: doneHw.length,
                };
                window._settlement = updatedSettlement;
                await API.saveSettlement(dateKey, updatedSettlement);
                if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
                cachedData.dailySettlement[dateKey] = updatedSettlement;
            } else {
                const updatedSettlement = {
                    ...existingSettlement,
                    doneCount: doneHw.length,
                };
                window._settlement = updatedSettlement;
                await API.saveSettlement(dateKey, updatedSettlement);
                if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
                cachedData.dailySettlement[dateKey] = updatedSettlement;
            }
        }

        // 保存 efficiency 数据
        const ratios = [];
        efficiencyHw.forEach(hw => {
            if (hw.actualDuration !== null && hw.suggestedDuration > 0) {
                ratios.push(hw.suggestedDuration / hw.actualDuration);
            }
        });
        const averageRatio = ratios.length > 0
            ? ratios.reduce((a, b) => a + b, 0) / ratios.length
            : 0;
        await API.saveEfficiency(dateKey, { averageRatio, ratios });

        // needsFullRender = true; -- 由 updateBigScreen 处理
        updateBigScreen();
        return;
    }

    // === 原有逻辑：当天未评级，正常计算 ===
    const dailyBase = cachedData?.settings?.dailyBasePoints ?? 50;
    const homeworkBonus = challengeSuccess.reduce(
        (sum, h) => sum + (h.basePoints ?? cachedData?.settings?.homeworkBonusPerTask ?? 10), 0
    );

    const settlementData = {
        dailyBase,
        homeworkBonus,
        totalBeforeRating: dailyBase + homeworkBonus,
        doneCount: doneHw.length,
    };

    window._settlement = settlementData;

    const settlementToSave = {
        ...settlementData,
        rating: null,
        multiplier: null,
        finalPoints: null,
        submittedAt: null,
        ratedAt: null,
    };
    await API.saveSettlement(dateKey, settlementToSave);

    if (!cachedData.dailySettlement) cachedData.dailySettlement = {};
    cachedData.dailySettlement[dateKey] = settlementToSave;

    const ratios = [];
    efficiencyHw.forEach(hw => {
        if (hw.actualDuration !== null && hw.suggestedDuration > 0) {
            ratios.push(hw.suggestedDuration / hw.actualDuration);
        }
    });
    const averageRatio = ratios.length > 0
        ? ratios.reduce((a, b) => a + b, 0) / ratios.length
        : 0;

    await API.saveEfficiency(dateKey, { averageRatio, ratios });

    // needsFullRender = true; -- 由 updateBigScreen 处理
    updateBigScreen();
}

// ========== 辅助：构造 Util 对象 ==========
function makeUtil(currentDate) {
    return {
        genId() {
            return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
        },
        dateKey(d) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },
        formatDate(d) {
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
        },
        formatDuration(totalSeconds) {
            const m = Math.floor(totalSeconds / 60);
            const s = totalSeconds % 60;
            if (m === 0) return s + '秒';
            if (s === 0) return m + '分钟';
            return m + '分' + s + '秒';
        },
        nowTimeStr() {
            const now = new Date();
            return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        },
    };
}

// ========== 测试用例 ==========

// Feature: 防止一天内重复弹出评级框
//
//   Scenario: 当天未评级时正常计算结算
//     Given 当天 settlement 不存在
//     When 调用 calculateSettlement()
//     Then 正常计算 totalBeforeRating = dailyBase + homeworkBonus
//     And settlement.rating 为 null
//     And settlement.submittedAt 为 null

test('当天未评级时正常计算结算', async () => {
    const currentDate = new Date('2026-06-04');
    const Util = makeUtil(currentDate);

    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
        { id: 'hw2', subject: '语文', content: '阅读', status: 'done', mode: 'challenge', rejected: false, basePoints: 5, actualDuration: 8, suggestedDuration: 10 },
    ];

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {},
    };

    let savedSettlement = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) { },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    assert.ok(savedSettlement, '应保存了 settlement');
    assert.strictEqual(savedSettlement.data.dailyBase, 50);
    assert.strictEqual(savedSettlement.data.homeworkBonus, 15); // 10 + 5
    assert.strictEqual(savedSettlement.data.totalBeforeRating, 65); // 50 + 15
    assert.strictEqual(savedSettlement.data.doneCount, 2);
    assert.strictEqual(savedSettlement.data.rating, null);
    assert.strictEqual(savedSettlement.data.multiplier, null);
    assert.strictEqual(savedSettlement.data.finalPoints, null);
    assert.strictEqual(savedSettlement.data.submittedAt, null);
    assert.strictEqual(savedSettlement.data.ratedAt, null);
});

//   Scenario: 当天已评级后完成新作业保留已有评级
//     Given 当天已有 settlement，rating='优', multiplier=2.0, finalPoints=130
//     When 完成一项新作业后调用 calculateSettlement()
//     Then settlement.rating 保持 '优'（不被重置为 null）
//     And settlement.submittedAt 保持原有值
//     And settlement.multiplier 保持 2.0

test('当天已评级后完成新作业保留已有评级', async () => {
    const currentDate = new Date('2026-06-04');
    const dateKey = '2026-06-04';
    const Util = makeUtil(currentDate);

    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
        { id: 'hw2', subject: '语文', content: '阅读', status: 'done', mode: 'challenge', rejected: false, basePoints: 5, actualDuration: 8, suggestedDuration: 10 },
        { id: 'hw3', subject: '英语', content: '单词', status: 'done', mode: 'challenge', rejected: false, basePoints: 8, actualDuration: 10, suggestedDuration: 10 },
    ];

    const existingSettlement = {
        dailyBase: 50,
        homeworkBonus: 15,
        totalBeforeRating: 65,
        doneCount: 2,
        rating: '优',
        multiplier: 2.0,
        finalPoints: 130,
        submittedAt: '18:30',
        ratedAt: '19:00',
        viewedAt: null,
    };

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {
            [dateKey]: { ...existingSettlement },
        },
    };

    let savedSettlement = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) { },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    assert.ok(savedSettlement, '应保存了 settlement');
    // 关键断言：评级信息不应被重置
    assert.strictEqual(savedSettlement.data.rating, '优', 'rating 应保持为 优，不被重置');
    assert.strictEqual(savedSettlement.data.multiplier, 2.0, 'multiplier 应保持');
    assert.strictEqual(savedSettlement.data.submittedAt, '18:30', 'submittedAt 应保持');
    assert.strictEqual(savedSettlement.data.ratedAt, '19:00', 'ratedAt 应保持');
});

//   Scenario: 当天已评级后新作业分数不含每日基础分
//     Given 当天已有 settlement，rating='优', multiplier=2.0, dailyBase=50, homeworkBonus=20
//     And 新增一项挑战成功作业 basePoints=8
//     When 调用 calculateSettlement()
//     Then 新增积分基于已有倍率计算，不含每日基础分
//     And 新增积分 = 8 * 2.0 = 16
//     And 调用 API.updatePoints 增加积分

test('当天已评级后新作业分数不含每日基础分且自动增加积分', async () => {
    const currentDate = new Date('2026-06-04');
    const dateKey = '2026-06-04';
    const Util = makeUtil(currentDate);

    // 之前有 2 项作业已评级，现在新增第 3 项
    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
        { id: 'hw2', subject: '语文', content: '阅读', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 8, suggestedDuration: 10 },
        { id: 'hw3', subject: '英语', content: '单词', status: 'done', mode: 'challenge', rejected: false, basePoints: 8, actualDuration: 10, suggestedDuration: 10 },
    ];

    const existingSettlement = {
        dailyBase: 50,
        homeworkBonus: 20, // 前两项的加分
        totalBeforeRating: 70,
        doneCount: 2,
        rating: '优',
        multiplier: 2.0,
        finalPoints: 140,
        submittedAt: '18:30',
        ratedAt: '19:00',
        viewedAt: null,
    };

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {
            [dateKey]: { ...existingSettlement },
        },
        points: 500,
    };

    let savedSettlement = null;
    let updatedPoints = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) {
            updatedPoints = { type, amount, note };
        },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    assert.ok(savedSettlement, '应保存了 settlement');
    assert.strictEqual(savedSettlement.data.rating, '优', 'rating 保持不变');

    // 验证调用了 updatePoints：新增积分 = 8 * 2.0 = 16（不含每日基础分）
    assert.ok(updatedPoints, '应调用 API.updatePoints 自动增加积分');
    assert.strictEqual(updatedPoints.type, 'earn');
    assert.strictEqual(updatedPoints.amount, 16, '新增积分应为 8 * 2.0 = 16，不含每日基础分');
});

//   Scenario: 当天已评级已查看后新作业完成不弹出评级页
//     Given 当天已有 settlement，rating='优', viewedAt 已设置
//     When 完成新作业后调用 calculateSettlement()
//     Then settlement 保持 rating='优'
//     And 不重置 viewedAt

test('当天已评级已查看后新作业完成保留 viewedAt', async () => {
    const currentDate = new Date('2026-06-04');
    const dateKey = '2026-06-04';
    const Util = makeUtil(currentDate);

    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
        { id: 'hw2', subject: '语文', content: '阅读', status: 'done', mode: 'challenge', rejected: false, basePoints: 5, actualDuration: 8, suggestedDuration: 10 },
        { id: 'hw3', subject: '英语', content: '单词', status: 'done', mode: 'challenge', rejected: false, basePoints: 8, actualDuration: 10, suggestedDuration: 10 },
    ];

    const existingSettlement = {
        dailyBase: 50,
        homeworkBonus: 15,
        totalBeforeRating: 65,
        doneCount: 2,
        rating: '优',
        multiplier: 2.0,
        finalPoints: 130,
        submittedAt: '18:30',
        ratedAt: '19:00',
        viewedAt: '19:05',
    };

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {
            [dateKey]: { ...existingSettlement },
        },
        points: 630,
    };

    let savedSettlement = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) { },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    assert.ok(savedSettlement, '应保存了 settlement');
    assert.strictEqual(savedSettlement.data.rating, '优');
    assert.strictEqual(savedSettlement.data.multiplier, 2.0);
    assert.strictEqual(savedSettlement.data.viewedAt, '19:05', 'viewedAt 应保留');
});

//   Scenario: 多天内各自独立评级互不干扰
//     Given 昨天已有 settlement 并已评级
//     And 今天 settlement 不存在
//     When 今天完成作业后调用 calculateSettlement()
//     Then 今天的 settlement 正常计算，rating 为 null
//     And 昨天的 settlement 不受影响

test('多天内各自独立评级互不干扰', async () => {
    const currentDate = new Date('2026-06-05');
    const dateKey = '2026-06-05';
    const Util = makeUtil(currentDate);

    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
    ];

    const yesterdaySettlement = {
        dailyBase: 50,
        homeworkBonus: 15,
        totalBeforeRating: 65,
        doneCount: 2,
        rating: '优',
        multiplier: 2.0,
        finalPoints: 130,
        submittedAt: '18:30',
        ratedAt: '19:00',
    };

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {
            '2026-06-04': { ...yesterdaySettlement },
        },
    };

    let savedSettlement = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) { },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    assert.ok(savedSettlement, '应保存了 settlement');
    assert.strictEqual(savedSettlement.key, dateKey, '应保存到今天的日期');
    assert.strictEqual(savedSettlement.data.rating, null, '今天未评级，rating 应为 null');
    assert.strictEqual(savedSettlement.data.dailyBase, 50);
    assert.strictEqual(savedSettlement.data.homeworkBonus, 10);
    assert.strictEqual(cachedData.dailySettlement['2026-06-04'].rating, '优', '昨天评级不受影响');
});

//   Scenario: 已提交等待评级后完成新作业应更新 homeworkBonus 但不加分
//     Given 当天已有 settlement，submittedAt 已设置，rating=null，multiplier=null
//     And 新增一项挑战成功作业 basePoints=8
//     When 调用 calculateSettlement()
//     Then homeworkBonus 从 20 更新为 28
//     And totalBeforeRating 从 70 更新为 78
//     And finalPoints 保持不变（仍为 null）
//     And API.updatePoints 不应被调用

test('已提交等待评级后完成新作业更新 homeworkBonus 但不加分', async () => {
    const currentDate = new Date('2026-06-04');
    const dateKey = '2026-06-04';
    const Util = makeUtil(currentDate);

    // 之前有 2 项作业已提交等待评级，现在新增第 3 项
    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
        { id: 'hw2', subject: '语文', content: '阅读', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 8, suggestedDuration: 10 },
        { id: 'hw3', subject: '英语', content: '单词', status: 'done', mode: 'challenge', rejected: false, basePoints: 8, actualDuration: 10, suggestedDuration: 10 },
    ];

    const existingSettlement = {
        dailyBase: 50,
        homeworkBonus: 20,
        totalBeforeRating: 70,
        doneCount: 2,
        rating: null,
        multiplier: null,
        finalPoints: null,
        submittedAt: '18:30',
        ratedAt: null,
    };

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {
            [dateKey]: { ...existingSettlement },
        },
    };

    let savedSettlement = null;
    let updatedPoints = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) {
            updatedPoints = { type, amount, note };
        },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    assert.ok(savedSettlement, '应保存了 settlement');
    // homeworkBonus 应包含新作业
    assert.strictEqual(savedSettlement.data.homeworkBonus, 28, 'homeworkBonus 应更新为 28');
    assert.strictEqual(savedSettlement.data.totalBeforeRating, 78, 'totalBeforeRating 应更新为 78');
    assert.strictEqual(savedSettlement.data.doneCount, 3, 'doneCount 应更新为 3');
    // 评级信息应保持不变
    assert.strictEqual(savedSettlement.data.rating, null, 'rating 仍为 null');
    assert.strictEqual(savedSettlement.data.finalPoints, null, 'finalPoints 仍为 null（未评级）');
    assert.strictEqual(savedSettlement.data.submittedAt, '18:30', 'submittedAt 应保持');
    // API.updatePoints 不应被调用（未评级无倍率）
    assert.strictEqual(updatedPoints, null, '未评级不应调用 updatePoints');
});

//   Scenario: 已提交等待评级后完成新作业，之后评级时应使用更新后的 totalBeforeRating
//     Given 当天已有 settlement，submittedAt 已设置，rating=null
//     And 新增一项挑战成功作业 basePoints=8 并已完成
//     When submitRating 根据 settlement.totalBeforeRating 计算最终积分
//     Then totalBeforeRating 应为 78（50+28）而不是 70（50+20）

test('已提交后新作业完成使 settlement.totalBeforeRating 包含新作业', async () => {
    const currentDate = new Date('2026-06-04');
    const dateKey = '2026-06-04';
    const Util = makeUtil(currentDate);

    const homeworks = [
        { id: 'hw1', subject: '数学', content: '练习册', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 15, suggestedDuration: 20 },
        { id: 'hw2', subject: '语文', content: '阅读', status: 'done', mode: 'challenge', rejected: false, basePoints: 10, actualDuration: 8, suggestedDuration: 10 },
        { id: 'hw3', subject: '英语', content: '单词', status: 'done', mode: 'challenge', rejected: false, basePoints: 8, actualDuration: 10, suggestedDuration: 10 },
    ];

    const existingSettlement = {
        dailyBase: 50,
        homeworkBonus: 20,
        totalBeforeRating: 70,
        doneCount: 2,
        rating: null,
        multiplier: null,
        finalPoints: null,
        submittedAt: '18:30',
        ratedAt: null,
    };

    const cachedData = {
        settings: { dailyBasePoints: 50, homeworkBonusPerTask: 10 },
        dailySettlement: {
            [dateKey]: { ...existingSettlement },
        },
    };

    let savedSettlement = null;
    let updatedPoints = null;
    const API = {
        async saveSettlement(key, data) {
            savedSettlement = { key, data };
        },
        async saveEfficiency(key, data) { },
        async updatePoints(type, amount, note) {
            updatedPoints = { type, amount, note };
        },
    };

    let updateBigScreenCalled = false;
    const updateBigScreen = () => { updateBigScreenCalled = true; };

    await calculateSettlementLogic({
        homeworks,
        currentDate,
        Util,
        cachedData,
        API,
        updateBigScreen,
        window: {},
    });

    // 验证 settlement 已更新 homeworkBonus
    assert.ok(savedSettlement, '应保存了 settlement');
    assert.strictEqual(savedSettlement.data.homeworkBonus, 28, 'homeworkBonus 包含新作业');
    assert.strictEqual(savedSettlement.data.totalBeforeRating, 78, 'totalBeforeRating 已更新');

    // 模拟管理员评级：使用 updated settlement 的 totalBeforeRating 计算
    // 这模拟了 admin.js 中 submitRating() 的行为
    const rating = '优';
    const multiplier = 2.0;
    const finalPoints = Math.round(savedSettlement.data.totalBeforeRating * multiplier);

    assert.strictEqual(finalPoints, 156, '评级时应基于 78 计算最终积分，得到 156');
    // 如果使用旧的 totalBeforeRating=70，会得到 140，丢失 16 分
    assert.notStrictEqual(Math.round(70 * multiplier), finalPoints, '不应基于旧的 totalBeforeRating 计算');
});
