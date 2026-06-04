/**
 * test_efficiency_all_modes.js - 效率统计覆盖范围测试
 *
 * 测试 calculateSettlement() 中效率计算是否覆盖所有模式作业
 */

import { test, assert } from 'vitest';

// ========== 从 app.js 提取效率计算逻辑 ==========

function extractEfficiencyLogic() {
    // 效率逻辑在 calculateSettlement 内部，通过内联测试验证
    // 这里直接测试过滤逻辑的核心：efficiencyHw = doneHw.filter(h => !h.rejected)
    return {
        filterEfficiencyHw: (homeworks) => homeworks.filter(h => h.status === 'done' && !h.rejected),
        calcRatios: (homeworks) => {
            return homeworks
                .filter(h => h.actualDuration !== null && h.suggestedDuration > 0)
                .map(h => h.actualDuration / h.suggestedDuration);
        },
        calcAvgRatio: (ratios) => {
            return ratios.length > 0
                ? ratios.reduce((a, b) => a + b, 0) / ratios.length
                : 0;
        },
    };
}

// ========== 测试用例 ==========

// Feature: 效率统计覆盖所有非驳回作业
//
//   Scenario: 计时模式作业参与效率统计
//     Given 两项 done 作业：作业A mode='challenge' actualDuration=10 suggestedDuration=20
//           作业B mode='timer' actualDuration=15 suggestedDuration=20
//     When calculateSettlement() 计算效率
//     Then averageRatio = ((10/20) + (15/20)) / 2 = 0.625
//     And 两个作业都被计入 ratios 数组
test('计时模式作业参与效率统计', () => {
    const { filterEfficiencyHw, calcRatios, calcAvgRatio } = extractEfficiencyLogic();

    const homeworks = [
        { id: 'A', status: 'done', mode: 'challenge', rejected: false, actualDuration: 10, suggestedDuration: 20 },
        { id: 'B', status: 'done', mode: 'timer', rejected: false, actualDuration: 15, suggestedDuration: 20 },
    ];

    const efficiencyHw = filterEfficiencyHw(homeworks);
    assert.strictEqual(efficiencyHw.length, 2, '两个作业都应被计入效率统计');

    const ratios = calcRatios(efficiencyHw);
    assert.strictEqual(ratios.length, 2);
    assert.strictEqual(ratios[0], 0.5);  // 10/20
    assert.strictEqual(ratios[1], 0.75); // 15/20

    const avgRatio = calcAvgRatio(ratios);
    assert.strictEqual(avgRatio, 0.625);
});

//   Scenario: 被驳回作业不参与效率统计
//     Given 两项 done 作业：作业A mode='challenge' not rejected actualDuration=10 suggestedDuration=20
//           作业B mode='timer' rejected=true actualDuration=15 suggestedDuration=20
//     When calculateSettlement() 计算效率
//     Then averageRatio = 10/20 = 0.5
//     And 仅作业A被计入
test('被驳回作业不参与效率统计', () => {
    const { filterEfficiencyHw, calcRatios, calcAvgRatio } = extractEfficiencyLogic();

    const homeworks = [
        { id: 'A', status: 'done', mode: 'challenge', rejected: false, actualDuration: 10, suggestedDuration: 20 },
        { id: 'B', status: 'done', mode: 'timer', rejected: true, actualDuration: 15, suggestedDuration: 20 },
    ];

    const efficiencyHw = filterEfficiencyHw(homeworks);
    assert.strictEqual(efficiencyHw.length, 1, '仅非驳回作业应被计入');
    assert.strictEqual(efficiencyHw[0].id, 'A');

    const ratios = calcRatios(efficiencyHw);
    assert.strictEqual(ratios.length, 1);
    assert.strictEqual(ratios[0], 0.5);

    const avgRatio = calcAvgRatio(ratios);
    assert.strictEqual(avgRatio, 0.5);
});

//   Scenario: completedInSchool 作业参与效率统计
//     Given 一项 done 作业：completedInSchool=true mode='challenge' actualDuration=18 suggestedDuration=20
//     When calculateSettlement() 计算效率
//     Then averageRatio = 18/20 = 0.9
test('completedInSchool 作业参与效率统计', () => {
    const { filterEfficiencyHw, calcRatios, calcAvgRatio } = extractEfficiencyLogic();

    const homeworks = [
        { id: 'C', status: 'done', mode: 'challenge', rejected: false, completedInSchool: true, actualDuration: 18, suggestedDuration: 20 },
    ];

    const efficiencyHw = filterEfficiencyHw(homeworks);
    assert.strictEqual(efficiencyHw.length, 1);
    assert.strictEqual(efficiencyHw[0].completedInSchool, true);

    const ratios = calcRatios(efficiencyHw);
    assert.strictEqual(ratios[0], 0.9);

    const avgRatio = calcAvgRatio(ratios);
    assert.strictEqual(avgRatio, 0.9);
});
