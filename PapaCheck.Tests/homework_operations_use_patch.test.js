/**
 * 作业操作（开始/暂停/继续/完成）应使用 PATCH 而非全量 PUT
 *
 * Feature: 作业操作使用 PATCH 而非全量 PUT
 *
 *   Scenario: 开始一项作业时只 PATCH status/startedAt/mode
 *     Given 存在一项 pending 状态的作业
 *     When 调用 startHomework
 *     Then 调用 API.patchHomework（而非 API.putHomework）
 *     And 参数只包含 status/startedAt/mode 三个字段
 *     And 仅对开始的那项作业发起调用
 *
 *   Scenario: 暂停作业时只 PATCH paused/wasPaused（UI 临时字段不持久化）
 *     Given 存在一项 doing 状态的作业
 *     When 调用 pauseActiveTask
 *     Then 调用 API.patchHomework
 *     And 参数只包含 paused/wasPaused（不含 _pausedElapsed 等 UI 临时字段）
 *
 *   Scenario: 完成作业时只 PATCH status/completedAt/actualDuration/mode（不含 UI 临时字段）
 *     Given 存在一项 doing 状态的作业
 *     When 调用 completeHomework
 *     Then 调用 API.patchHomework
 *     And 参数只包含完成相关字段（不含 _animClass）
 *
 *   Scenario: 开始/暂停/完成不调用 saveHomeworksSilent
 *     Given 有多个作业
 *     When 对其中一个执行开始/暂停/完成
 *     Then 不调用 API.putHomework（确保不用全量 PUT）
 */
import { test, assert, expect } from 'vitest';

// ========== 提取 app.js 中的函数 ==========

function extractFunction(name) {
  const appCode = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'PapaCheck.Web', 'js', 'app.js'),
    'utf8'
  );
  // 匹配从 "async function <name>" 到最近的 "}\n" (函数级)
  const match = appCode.match(new RegExp('async function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
  return match ? match[0] : null;
}

// ========== RED: 开始作业使用 PATCH ==========

test('RED: 开始作业调用 API.patchHomework 而非 API.putHomework', async () => {
  const fnCode = extractFunction('startHomework');
  assert.ok(fnCode, 'startHomework 函数应存在于 app.js 中');

  // 验证函数体使用了 API.patchHomework
  assert.ok(fnCode.includes('API.patchHomework'),
    'startHomework 应调用 API.patchHomework（当前使用了: ' +
    (fnCode.includes('API.putHomework') ? 'API.putHomework' :
     fnCode.includes('saveHomeworksSilent') ? 'saveHomeworksSilent' : '其他') + '）');

  // 验证函数体未使用 API.putHomework 或 saveHomeworksSilent
  assert.ok(!fnCode.includes('API.putHomework'),
    'startHomework 不应调用 API.putHomework');
  assert.ok(!fnCode.includes('saveHomeworksSilent'),
    'startHomework 不应调用 saveHomeworksSilent');
});

test('RED: 开始作业 PATCH 只含 status/startedAt/mode', async () => {
  const fnCode = extractFunction('startHomework');
  assert.ok(fnCode);

  // 提取 patchHomework 调用参数
  const patchCall = fnCode.match(/API\.patchHomework\([^;]+\)/);
  assert.ok(patchCall, '应包含 API.patchHomework 调用');

  const callStr = patchCall[0];
  // 验证字段列表
  assert.ok(callStr.includes("status:"), '应包含 status');
  assert.ok(callStr.includes("startedAt:"), '应包含 startedAt');
  assert.ok(callStr.includes("mode:"), '应包含 mode');

  // 验证只有这三个显式字段（忽略 dateKey 参数）
  const fieldCount = (callStr.match(/\b(status|startedAt|mode|paused|wasPaused|_pausedElapsed|completedAt|actualDuration|_animClass|completedInSchool)\s*:/g) || []).length;
  assert.strictEqual(fieldCount, 3, '应只包含 3 个字段，实际包含 ' + fieldCount + ' 个');
});

// ========== RED: 暂停作业使用 PATCH ==========

test('RED: 暂停作业调用 API.patchHomework 含 paused/wasPaused', async () => {
  const fnCode = extractFunction('pauseActiveTask');
  assert.ok(fnCode, 'pauseActiveTask 函数应存在于 app.js 中');

  assert.ok(fnCode.includes('API.patchHomework'),
    'pauseActiveTask 应调用 API.patchHomework');
  assert.ok(!fnCode.includes('API.putHomework'),
    'pauseActiveTask 不应调用 API.putHomework');
  assert.ok(!fnCode.includes('saveHomeworksSilent'),
    'pauseActiveTask 不应调用 saveHomeworksSilent');

  const patchCall = fnCode.match(/API\.patchHomework\([^;]+\)/);
  assert.ok(patchCall, '应包含 API.patchHomework 调用');

  const callStr = patchCall[0];
  assert.ok(callStr.includes('paused:'), '应包含 paused');
  assert.ok(callStr.includes('wasPaused:'), '应包含 wasPaused');
  // UI 临时字段 _pausedElapsed 不应持久化到服务器
  assert.ok(!callStr.includes('_pausedElapsed:'), '不应包含 _pausedElapsed（UI 临时字段不应持久化）');
});

// ========== RED: 完成作业使用 PATCH ==========

test('RED: 完成作业调用 API.patchHomework 含完成相关字段', async () => {
  const fnCode = extractFunction('completeHomework');
  assert.ok(fnCode, 'completeHomework 函数应存在于 app.js 中');

  assert.ok(fnCode.includes('API.patchHomework'),
    'completeHomework 应调用 API.patchHomework');
  assert.ok(!fnCode.includes('API.putHomework'),
    'completeHomework 不应调用 API.putHomework');
  assert.ok(!fnCode.includes('saveHomeworksSilent'),
    'completeHomework 不应调用 saveHomeworksSilent');

  const patchCall = fnCode.match(/API\.patchHomework\([^;]+\)/);
  assert.ok(patchCall, '应包含 API.patchHomework 调用');

  const callStr = patchCall[0];
  assert.ok(callStr.includes('status:'), '应包含 status');
  assert.ok(callStr.includes('completedAt:'), '应包含 completedAt');
  assert.ok(callStr.includes('actualDuration:'), '应包含 actualDuration');
  assert.ok(callStr.includes('mode:'), '应包含 mode');
});

// ========== RED: completeInSchool 使用 PATCH ==========

test('RED: completeInSchool 调用 API.patchHomework', async () => {
  const fnCode = extractFunction('completeInSchool');
  assert.ok(fnCode, 'completeInSchool 函数应存在于 app.js 中');

  // 只检查非 deps 路径
  assert.ok(fnCode.includes('API.patchHomework'),
    'completeInSchool 应调用 API.patchHomework');
});
