/**
 * 自由时间操作（开始/暂停/继续/完成）应只保存当前操作的单个任务，而非全部
 *
 * Feature: 自由时间操作使用直接 PUT 而非全量保存
 *
 *   Scenario: 开始一项自由时间时只 PUT 当前任务
 *     Given 存在多项自由时间
 *     When 调用 startFreeTime(id)
 *     Then 调用 API.putFreeTimeTask（而非 saveFreeTimeSilent）
 *
 *   Scenario: 完成自由时间时只 PUT 当前任务
 *     Given 存在一项 doing 的自由时间
 *     When 调用 completeFreeTime(id)
 *     Then 调用 API.putFreeTimeTask（而非 saveFreeTimeSilent）
 *
 *   Scenario: 暂停作业时，如果当前是自由时间则 PUT 自由时间
 *     Given 存在一项 doing 的自由时间
 *     When 调用 pauseActiveTask
 *     Then 调用 API.putFreeTimeTask（而非 saveFreeTimeSilent）
 *
 *   Scenario: 继续作业时，如果当前是自由时间则 PUT 自由时间
 *     Given 存在一项 paused 的自由时间
 *     When 调用 resumeActiveTask
 *     Then 调用 API.putFreeTimeTask（而非 saveFreeTimeSilent）
 *
 *   Scenario: pollServer 保护进行中的自由时间不被过期数据覆盖
 *     Given 存在一项 doing 的自由时间
 *     When pollServer 检测到本地 doing 但服务器 pending
 *     Then 不替换 freeTimeTasks
 */
import { test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';

function extractFunction(name) {
  var appCode = fs.readFileSync(
    path.join(__dirname, '..', 'app.js'),
    'utf8'
  );
  var match = appCode.match(new RegExp('async function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
  return match ? match[0] : null;
}

function extractNonAsync(name) {
  var appCode = fs.readFileSync(
    path.join(__dirname, '..', 'app.js'),
    'utf8'
  );
  var match = appCode.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
  return match ? match[0] : null;
}

test('RED: startFreeTime 调用 API.putFreeTimeTask 而非 saveFreeTimeSilent', async () => {
  var fnCode = extractFunction('startFreeTime');
  assert.ok(fnCode, 'startFreeTime 应存在于 app.js');
  assert.ok(fnCode.includes('API.putFreeTimeTask'),
    '应调用 API.putFreeTimeTask，当前使用: ' +
    (fnCode.includes('saveFreeTimeSilent') ? 'saveFreeTimeSilent' : '其他'));
  assert.ok(!fnCode.includes('saveFreeTimeSilent'),
    '不应调用 saveFreeTimeSilent');
  assert.ok(fnCode.includes('await '),
    '应包含 await');
});

test('RED: completeFreeTime 调用 API.putFreeTimeTask 而非 saveFreeTimeSilent', async () => {
  var fnCode = extractFunction('completeFreeTime');
  assert.ok(fnCode, 'completeFreeTime 应存在于 app.js');
  assert.ok(fnCode.includes('API.putFreeTimeTask'),
    '应调用 API.putFreeTimeTask');
  assert.ok(!fnCode.includes('saveFreeTimeSilent'),
    '不应调用 saveFreeTimeSilent');
});

test('RED: pauseActiveTask 在自由时间分支调用 API.putFreeTimeTask', async () => {
  var fnCode = extractFunction('pauseActiveTask');
  assert.ok(fnCode, 'pauseActiveTask 应存在于 app.js');
  var elseBranch = fnCode.match(/else\s+await\s+\S+/);
  assert.ok(elseBranch, '应有 else 分支');
  assert.ok(elseBranch[0].includes('API.putFreeTimeTask'),
    'else 分支应调用 API.putFreeTimeTask，当前: ' + elseBranch[0]);
});

test('RED: resumeActiveTask 在自由时间分支调用 API.putFreeTimeTask', async () => {
  var fnCode = extractFunction('resumeActiveTask');
  assert.ok(fnCode, 'resumeActiveTask 应存在于 app.js');
  var elseBranch = fnCode.match(/else\s+await\s+\S+/);
  assert.ok(elseBranch, '应有 else 分支');
  assert.ok(elseBranch[0].includes('API.putFreeTimeTask'),
    'else 分支应调用 API.putFreeTimeTask，当前: ' + elseBranch[0]);
});

test('RED: refreshFromServer 从服务端权威拉取自由时间（不被过期数据覆盖）', async () => {
  var appCode = fs.readFileSync(
    path.join(__dirname, '..', 'app.js'),
    'utf8'
  );
  // T04 后轮询改为 refreshFromServer：自由时间始终从服务端 Data.day.getFreeTime 权威拉取，
  // 取代旧版 newFtJson / hasActiveFt 客户端合并，天然避免被过期数据覆盖。
  var assignArea = appCode.match(/freeTimeTasks\s*=\s*await\s+Data\.day\.getFreeTime\([^)]*\)/);
  assert.ok(assignArea, 'refreshFromServer 应从服务端 Data.day.getFreeTime 权威拉取自由时间');
});
