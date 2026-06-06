/**
 * test_pie_chart.js - 饼图渲染 Bug 修复测试
 *
 * 测试 renderSvgPieChart 在单段 100% 时的渲染
 */

import { test, assert } from 'vitest';

// ========== 从 admin.js 提取真实的 renderSvgPieChart ==========

import fs from 'fs';
import path from 'path';

function loadPieChartFn() {
    const adminCode = fs.readFileSync(
        path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'admin.js'),
        'utf8'
    );
    const match = adminCode.match(/function renderSvgPieChart\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!match) return null;
    return new Function('return ' + match[0])();
}

// ========== 测试用例 ==========

// Bug: 全部评级为「优」时饼图不显示
// 根因：360° 弧线起点和终点坐标相同，SVG 弧线退化为空

//   Scenario: 全部评级为优时饼图正常渲染
//     Given 一周评级全部为「优」(count=7)
//     When 渲染饼图
//     Then SVG path 的起点和终点坐标不应相同（非退化弧线）
test('全部评级为优时饼图路径坐标不退化', () => {
    const fn = loadPieChartFn();
    assert.ok(fn, 'renderSvgPieChart 函数应存在于 admin.js 中');

    const data = [{ rating: '优', count: 7 }];
    const total = 7;
    const svg = fn(data, total);

    // 提取 path 中的坐标
    const match = svg.match(/A[\d.]+,[\d.]+ \d [\d.]+,[\d.]+ ([\d.]+),([\d.]+)/);
    assert.ok(match, 'path 中应包含弧线命令');

    const x2 = parseFloat(match[1]);
    const y2 = parseFloat(match[2]);

    // 弧线终点不应等于起点——即不是退化弧线
    // 正常情况：x2 应不等于起点的 x1（80+cx_offset），y2 应不等于 y1
    assert.ok(!(Math.abs(x2 - 80) < 0.01 && Math.abs(y2 - 15) < 0.01),
        '弧线终点不应与起点相同（非退化弧线），当前终点: (' + x2 + ', ' + y2 + ')，起点: (80, 15)');
});

//   Scenario: 多评级正常渲染
//     Given 评级分布：优=3, 良=2, 可=1
//     When 渲染饼图
//     Then SVG 包含 3 个 path 元素
test('多评级正常渲染', () => {
    const fn = loadPieChartFn();
    assert.ok(fn);

    const data = [
        { rating: '优', count: 3 },
        { rating: '良', count: 2 },
        { rating: '可', count: 1 },
    ];
    const total = 6;
    const svg = fn(data, total);

    const pathCount = (svg.match(/<path/g) || []).length;
    assert.strictEqual(pathCount, 3, '应有 3 个 path 元素');
});
