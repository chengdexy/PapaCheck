/**
 * test_actual_duration.js - 作业用时下限保护单元测试
 *
 * 测试 clampActualDuration 函数：
 * 当 actualDuration <= suggestedDuration * 20% 且 actualDuration <= 1 分钟时，
 * 修正 actualDuration = suggestedDuration
 */

import { test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';

// ========== 从 app.js 提取 clampActualDuration ==========

function loadClampFunction() {
    const appCode = fs.readFileSync(
        path.join(__dirname, '..', 'app.js'),
        'utf8'
    );

    // 用正则提取 clampActualDuration 函数体
    const match = appCode.match(/function clampActualDuration\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!match) return null;

    // 在隔离环境中执行提取的函数
    const fn = new Function('return ' + match[0])();
    return fn;
}

// ========== 测试用例 ==========

// Feature: 作业用时下限保护
//
//   Scenario: 正常用时不受影响
//     Given 建议时长20分钟，实际用时5分钟
//     When 计算入库用时
//     Then 入库用时为5分钟
test('正常用时不受影响', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(5, 20), 5);
});

//   Scenario: 用时低于20%且≤1分钟，修正为建议时长
//     Given 建议时长10分钟，实际用时1分钟
//     When 计算入库用时
//     Then 入库用时为10分钟
test('用时低于20%且≤1分钟，修正为建议时长', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(1, 10), 10);
});

//   Scenario: 用时低于20%但>1分钟，不修正
//     Given 建议时长10分钟，实际用时3分钟
//     When 计算入库用时
//     Then 入库用时为3分钟
test('用时低于20%但>1分钟，不修正', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(3, 10), 3);
});

//   Scenario: 用时>20%但≤1分钟（建议时长极短），不修正
//     Given 建议时长3分钟，实际用时1分钟
//     When 计算入库用时
//     Then 入库用时为1分钟
test('用时>20%但≤1分钟（建议时长极短），不修正', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(1, 3), 1);
});

//   Scenario: 计时模式无建议时长，不修正
//     Given 建议时长0，实际用时1分钟
//     When 计算入库用时
//     Then 入库用时为1分钟
test('计时模式无建议时长，不修正', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(1, 0), 1);
});

//   Scenario: 边界值-刚好等于20%且≤1分钟
//     Given 建议时长5分钟，实际用时1分钟
//     When 计算入库用时
//     Then 入库用时为5分钟
test('边界值-刚好等于20%且≤1分钟', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(1, 5), 5);
});

//   Scenario: 边界值-刚好超过20%
//     Given 建议时长5分钟，实际用时2分钟
//     When 计算入库用时
//     Then 入库用时为2分钟
test('边界值-刚好超过20%', () => {
    const clamp = loadClampFunction();
    assert.ok(clamp, 'clampActualDuration 函数应存在于 app.js 中');
    assert.strictEqual(clamp(2, 5), 2);
});
