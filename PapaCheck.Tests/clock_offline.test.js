/**
 * clock_offline.test.js - 离线模式下时钟持续更新测试
 *
 * Feature: 离线模式下时钟持续更新
 *   Scenario: 时钟更新与任务计时器解耦
 *     Given 孩子端已初始化
 *     When tickInterval 被停止（stopTickTimer 调用）
 *     Then clockInterval 仍然运行，时钟继续更新
 *
 *   Scenario: init 启动独立时钟定时器
 *     Given 孩子端初始化
 *     Then 启动 clockInterval（30 秒间隔），且永不停止
 *
 *   Scenario: 屏保时钟由 updateMainClock 统一更新
 *     Given 孩子端已初始化
 *     Then updateMainClock 同时更新主界面时钟和屏保时钟
 *     And 不再有独立的 updateSaverTime 定时器
 */
import { test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';

function readAppJS() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'app.js'),
    'utf8'
  );
}

function readBigScreenJS() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'big-screen.js'),
    'utf8'
  );
}

test('RED: app.js 包含 clockInterval 变量声明和 startClockTimer 函数', () => {
  var code = readAppJS();
  assert.ok(
    /(let|var|const)\s+clockInterval\s*=\s*null/.test(code),
    '应声明 clockInterval = null'
  );
  assert.ok(
    code.includes('function startClockTimer'),
    '应定义 startClockTimer 函数'
  );
});

test('RED: init 调用 startClockTimer', () => {
  var code = readAppJS();
  var initMatch = code.match(/async function init[\s\S]*?\n\}/);
  assert.ok(initMatch, '应找到 init 函数');
  var initBody = initMatch[0];
  assert.ok(
    initBody.includes('startClockTimer()'),
    'init 应调用 startClockTimer()'
  );
});

test('RED: clockInterval 使用 30000ms 间隔且永不停止', () => {
  var code = readAppJS();
  // 应使用 setInterval 且间隔为 30000
  var intervalMatch = code.match(/clockInterval\s*=\s*setInterval\s*\([^)]+\)/);
  assert.ok(intervalMatch, 'clockInterval 应由 setInterval 赋值');
  assert.ok(
    intervalMatch[0].includes('30000'),
    'clockInterval 间隔应为 30000ms'
  );
  // 不应有清除 clockInterval 的代码
  assert.ok(
    !code.includes('clearInterval(clockInterval)'),
    '不应在任何地方清除 clockInterval'
  );
  assert.ok(
    !code.includes('clearInterval(clockInterval)'),
    '也不应有 stopClockTimer 的调用'
  );
});

test('RED: tickFrame 不再包含时钟更新', () => {
  var code = readBigScreenJS();
  var tickMatch = code.match(/function tickFrame[\s\S]*?\n\}/);
  assert.ok(tickMatch, '应找到 tickFrame 函数');
  var tickBody = tickMatch[0];
  // 时钟更新不应在 tickFrame 里
  assert.ok(
    !tickBody.includes('bigDate'),
    'tickFrame 不应包含 bigDate 更新'
  );
  assert.ok(
    !tickBody.includes('bigTime'),
    'tickFrame 不应包含 bigTime 更新'
  );
});

test('RED: app.js 包含独立的 updateMainClock 函数', () => {
  var code = readAppJS();
  assert.ok(
    code.includes('function updateMainClock'),
    '应定义 updateMainClock 函数'
  );
  assert.ok(
    code.includes('bigDate'),
    'updateMainClock 应更新 bigDate'
  );
  assert.ok(
    code.includes('bigTime'),
    'updateMainClock 应更新 bigTime'
  );
});

test('RED: updateMainClock 也更新屏保时钟', () => {
  var code = readAppJS();
  assert.ok(
    code.includes('saverTime'),
    'updateMainClock 应更新 saverTime'
  );
  assert.ok(
    code.includes('saverDate'),
    'updateMainClock 应更新 saverDate'
  );
});

test('RED: 移除旧的 updateSaverTime 独立定时器', () => {
  var code = readAppJS();
  assert.ok(
    !code.includes('saverTimeInterval'),
    '不应再有 saverTimeInterval 变量'
  );
  assert.ok(
    !code.includes('function updateSaverTime'),
    '不应再有独立的 updateSaverTime 函数'
  );
});
