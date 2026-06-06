/**
 * test_completed_in_school.js - 在校提前完成功能单元测试
 *
 * 测试 app.js 中 completeInSchool() 函数
 */

import { test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';

// ========== 从 app.js 提取 completeInSchool ==========

function loadCompleteInSchool() {
    const appCode = fs.readFileSync(
        path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'app.js'),
        'utf8'
    );

    const match = appCode.match(/async function completeInSchool\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!match) return null;

    const fn = new Function('return ' + match[0])();
    return fn;
}

// ========== 测试用例 ==========

// Feature: 在校提前完成作业
//
//   Scenario: 正常标记在校提前完成
//     Given 一项作业 status='pending', suggestedDuration=20, rejected=false, 无 deferRequest
//     When 调用 completeInSchool(hwId)
//     Then status='done', mode='challenge', completedInSchool=true
//     And actualDuration = ceil(20 * 0.9) = 18
//     And startedAt 和 completedAt 为当前 ISO 时间且相等
test('正常标记在校提前完成', async () => {
    const fn = loadCompleteInSchool();
    assert.ok(fn, 'completeInSchool 函数应存在于 app.js 中');

    const hw = {
        id: 'test-hw-1',
        status: 'pending',
        suggestedDuration: 20,
        rejected: false,
        deferRequest: null,
        mode: 'pending',
        startedAt: null,
        completedAt: null,
        actualDuration: null,
        completedInSchool: false,
    };
    const homeworks = [hw];
    let saved = false;

    // Mock 依赖
    const findHomeworkById = (id) => homeworks.find(h => h.id === id);
    const saveHomeworks = async () => { saved = true; };
    const checkAllDone = async () => { };
    const updateBigScreen = () => { };
    const speak = (msg) => { };

    const completeInSchool = fn;
    await completeInSchool(hw.id, { homeworks, findHomeworkById, saveHomeworks, checkAllDone, updateBigScreen, speak });

    assert.strictEqual(hw.status, 'done');
    assert.strictEqual(hw.mode, 'challenge');
    assert.strictEqual(hw.completedInSchool, true);
    assert.strictEqual(hw.actualDuration, Math.ceil(20 * 0.9)); // 18
    assert.ok(hw.startedAt, 'startedAt 应被设置');
    assert.ok(hw.completedAt, 'completedAt 应被设置');
    assert.strictEqual(hw.startedAt, hw.completedAt);
    assert.strictEqual(saved, true);
});

//   Scenario: 已完成的作业重复调用被忽略
//     Given 一项作业 status='done'
//     When 调用 completeInSchool(hwId)
//     Then 函数静默返回，作业状态不变
test('已完成的作业重复调用被忽略', async () => {
    const fn = loadCompleteInSchool();
    assert.ok(fn, 'completeInSchool 函数应存在于 app.js 中');

    const hw = {
        id: 'test-hw-2',
        status: 'done',
        suggestedDuration: 20,
        rejected: false,
        mode: 'timer',
        startedAt: '2026-06-04T10:00:00Z',
        completedAt: '2026-06-04T10:15:00Z',
        actualDuration: 15,
        completedInSchool: false,
    };
    const homeworks = [hw];
    let saved = false;

    const findHomeworkById = (id) => homeworks.find(h => h.id === id);
    const saveHomeworks = async () => { saved = true; };

    const completeInSchool = fn;
    await completeInSchool(hw.id, { homeworks, findHomeworkById, saveHomeworks });

    // 状态不应改变
    assert.strictEqual(hw.status, 'done');
    assert.strictEqual(hw.mode, 'timer');
    assert.strictEqual(hw.completedInSchool, false);
    assert.strictEqual(hw.actualDuration, 15);
    assert.strictEqual(saved, false);
});

//   Scenario: suggestedDuration 为 0 时 actualDuration 为 0
//     Given 一项作业 suggestedDuration=0
//     When 调用 completeInSchool(hwId)
//     Then actualDuration = 0
test('suggestedDuration 为 0 时 actualDuration 为 0', async () => {
    const fn = loadCompleteInSchool();
    assert.ok(fn, 'completeInSchool 函数应存在于 app.js 中');

    const hw = {
        id: 'test-hw-3',
        status: 'pending',
        suggestedDuration: 0,
        rejected: false,
        deferRequest: null,
        mode: 'pending',
        startedAt: null,
        completedAt: null,
        actualDuration: null,
        completedInSchool: false,
    };
    const homeworks = [hw];
    let saved = false;

    const findHomeworkById = (id) => homeworks.find(h => h.id === id);
    const saveHomeworks = async () => { saved = true; };
    const checkAllDone = async () => { };
    const updateBigScreen = () => { };
    const speak = (msg) => { };

    const completeInSchool = fn;
    await completeInSchool(hw.id, { homeworks, findHomeworkById, saveHomeworks, checkAllDone, updateBigScreen, speak });

    assert.strictEqual(hw.status, 'done');
    assert.strictEqual(hw.actualDuration, 0);
    assert.strictEqual(hw.completedInSchool, true);
});

//   Scenario: suggestedDuration 为 30 时 actualDuration 向上取整
//     Given 一项作业 suggestedDuration=30
//     When 调用 completeInSchool(hwId)
//     Then actualDuration = ceil(30 * 0.9) = 27
test('suggestedDuration 为 30 时 actualDuration 向上取整', async () => {
    const fn = loadCompleteInSchool();
    assert.ok(fn, 'completeInSchool 函数应存在于 app.js 中');

    const hw = {
        id: 'test-hw-4',
        status: 'pending',
        suggestedDuration: 30,
        rejected: false,
        deferRequest: null,
        mode: 'pending',
        startedAt: null,
        completedAt: null,
        actualDuration: null,
        completedInSchool: false,
    };
    const homeworks = [hw];
    let saved = false;

    const findHomeworkById = (id) => homeworks.find(h => h.id === id);
    const saveHomeworks = async () => { saved = true; };
    const checkAllDone = async () => { };
    const updateBigScreen = () => { };
    const speak = (msg) => { };

    const completeInSchool = fn;
    await completeInSchool(hw.id, { homeworks, findHomeworkById, saveHomeworks, checkAllDone, updateBigScreen, speak });

    assert.strictEqual(hw.actualDuration, Math.ceil(30 * 0.9)); // 27
});

//   Scenario: suggestedDuration 为 7 时 actualDuration 向上取整
//     Given 一项作业 suggestedDuration=7
//     When 调用 completeInSchool(hwId)
//     Then actualDuration = ceil(7 * 0.9) = ceil(6.3) = 7
test('suggestedDuration 为 7 时 actualDuration 向上取整', async () => {
    const fn = loadCompleteInSchool();
    assert.ok(fn, 'completeInSchool 函数应存在于 app.js 中');

    const hw = {
        id: 'test-hw-5',
        status: 'pending',
        suggestedDuration: 7,
        rejected: false,
        deferRequest: null,
        mode: 'pending',
        startedAt: null,
        completedAt: null,
        actualDuration: null,
        completedInSchool: false,
    };
    const homeworks = [hw];
    let saved = false;

    const findHomeworkById = (id) => homeworks.find(h => h.id === id);
    const saveHomeworks = async () => { saved = true; };
    const checkAllDone = async () => { };
    const updateBigScreen = () => { };
    const speak = (msg) => { };

    const completeInSchool = fn;
    await completeInSchool(hw.id, { homeworks, findHomeworkById, saveHomeworks, checkAllDone, updateBigScreen, speak });

    assert.strictEqual(hw.actualDuration, Math.ceil(7 * 0.9)); // ceil(6.3) = 7
});
