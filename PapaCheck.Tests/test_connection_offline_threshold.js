/**
 * test_connection_offline_threshold.js
 *
 * Feature: 连接管理器容错 —— 防止偶发 ping 失败导致错误切换到离线模式
 *   孩子端静置一段时间后（如设备休眠、浏览器标签页后台），setInterval 被浏览器
 *   节流到约 60 秒触发一次。恢复时网络栈需要唤醒时间（Wi-Fi 重连、DNS 刷新等），
 *   单次 ping 可能超时。当前代码没有重试机制，一次失败即判定离线。
 *
 *   修复思路：复用已声明但未使用的 _failCount 变量，引入失败阈值。
 *   仅当连续失败达到阈值（如 3 次）时才切换为离线模式，偶发失败被容错忽略。
 */

import { test, assert } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ============================================================
// 从 connection.js 提取的可测试纯函数
// 等价于 ConnectionManager 中 ping 结果处理逻辑
// ============================================================

/**
 * 连接状态机核心决策逻辑（提取自 connection.js _ping() + setInterval 回调）
 *
 * 当前 buggy 行为：单次 ping 失败即切离线（_failCount 被声明但从未用于决策）
 * 修复后行为：连续失败达到 FAILURE_THRESHOLD 才切离线
 */

const FAILURE_THRESHOLD = 3;
const MODE = { ONLINE: 'online', OFFLINE: 'offline', RECONNECTING: 'reconnecting' };

/**
 * 处理单次 ping 结果，更新状态机
 *
 * @param {{ mode: string, failCount: number, wasOnline: boolean }} state - 当前状态
 * @param {boolean} pingOk - 本次 ping 是否成功
 * @returns {{ mode: string, failCount: number, wasOnline: boolean, shouldToast: boolean, shouldReconnect: boolean }}
 */
function processPingResult(state, pingOk) {
  const failCount = pingOk ? 0 : state.failCount + 1;
  const wasOnline = state.wasOnline;

  if (pingOk) {
    // Ping 成功：清除失败计数，保持/恢复在线
    const shouldReconnect = (state.mode === MODE.OFFLINE && wasOnline && failCount === 0);
    return {
      mode: shouldReconnect ? MODE.RECONNECTING : MODE.ONLINE,
      failCount: 0,  // 重置计数器
      wasOnline: wasOnline || true,
      shouldToast: false,
      shouldReconnect,
    };
  } else {
    // Ping 失败：仅当连续失败达到阈值才切离线
    if (failCount >= FAILURE_THRESHOLD) {
      const shouldToast = state.mode === MODE.ONLINE;
      return {
        mode: MODE.OFFLINE,
        failCount,
        wasOnline,
        shouldToast,
        shouldReconnect: false,
      };
    } else {
      // 偶发失败：保持当前模式，仅累加计数器
      return {
        mode: state.mode,  // 不变！
        failCount,
        wasOnline,
        shouldToast: false,
        shouldReconnect: false,
      };
    }
  }
}

// ============================================================
// Scenario 1: 单次 ping 失败不切换离线
//   Given 孩子端当前处于在线模式（mode = 'online'）
//   And   本次 ping 失败（如网络短暂抖动）
//   When  ConnectionManager 处理 ping 结果
//   Then  模式保持 'online'（不切换离线）
//   And   失败计数器加 1
//   And   不弹出"网络连接断开"提示
// ============================================================
test('单次 ping 失败不应切换到离线模式', () => {
  const state = { mode: MODE.ONLINE, failCount: 0, wasOnline: true };
  const result = processPingResult(state, false);

  assert.strictEqual(result.mode, MODE.ONLINE, '单次 ping 失败应保持在线模式');
  assert.strictEqual(result.failCount, 1, '失败计数器应为 1');
  assert.strictEqual(result.shouldToast, false, '不应弹出断网提示');
  assert.strictEqual(result.shouldReconnect, false, '不应触发重连');
});

// ============================================================
// Scenario 2: 连续 2 次 ping 失败仍不切换离线
//   Given 孩子端当前处于在线模式
//   And   已经连续 1 次 ping 失败
//   When  第 2 次 ping 也失败
//   Then  模式仍保持 'online'
//   And   失败计数器累加到 2
// ============================================================
test('连续 2 次 ping 失败仍不切换离线', () => {
  // 第 1 次失败
  let state = { mode: MODE.ONLINE, failCount: 0, wasOnline: true };
  state = processPingResult(state, false);
  assert.strictEqual(state.mode, MODE.ONLINE, '第 1 次失败后应保持在线');
  assert.strictEqual(state.failCount, 1);

  // 第 2 次失败
  state = processPingResult(state, false);
  assert.strictEqual(state.mode, MODE.ONLINE, '第 2 次失败后仍保持在线');
  assert.strictEqual(state.failCount, 2);
  assert.strictEqual(state.shouldToast, false, '不应弹出断网提示');
});

// ============================================================
// Scenario 3: 连续 3 次 ping 失败后切换离线
//   Given 孩子端当前处于在线模式
//   And   已经连续 2 次 ping 失败
//   When  第 3 次 ping 也失败
//   Then  模式切换为 'offline'
//   And   弹出"网络连接断开"提示
// ============================================================
test('连续 3 次 ping 失败后切换离线并提示用户', () => {
  let state = { mode: MODE.ONLINE, failCount: 0, wasOnline: true };

  // 连续失败 2 次
  state = processPingResult(state, false);
  state = processPingResult(state, false);
  assert.strictEqual(state.failCount, 2);
  assert.strictEqual(state.mode, MODE.ONLINE);

  // 第 3 次失败 → 切离线
  state = processPingResult(state, false);
  assert.strictEqual(state.mode, MODE.OFFLINE, '第 3 次失败应切换离线');
  assert.strictEqual(state.failCount, 3);
  assert.strictEqual(state.shouldToast, true, '应弹出断网提示');
});

// ============================================================
// Scenario 4: 失败后一次成功 ping 重置计数器
//   Given 孩子端当前处于在线模式
//   And   已经连续 2 次 ping 失败
//   When  第 3 次 ping 成功
//   Then  模式保持 'online'
//   And   失败计数器重置为 0
//   And   不触发任何提示
// ============================================================
test('失败后 ping 成功应重置失败计数器', () => {
  let state = { mode: MODE.ONLINE, failCount: 0, wasOnline: true };

  // 连续失败 2 次
  state = processPingResult(state, false);
  state = processPingResult(state, false);
  assert.strictEqual(state.failCount, 2);

  // 第 3 次成功 → 重置计数器
  state = processPingResult(state, true);
  assert.strictEqual(state.mode, MODE.ONLINE, 'ping 成功后应保持在线');
  assert.strictEqual(state.failCount, 0, '失败计数器应重置为 0');
  assert.strictEqual(state.shouldToast, false, '不应弹出提示');
});

// ============================================================
// Scenario 5: 离线模式下 ping 恢复触发重连
//   Given 孩子端之前在线过（wasOnline = true）
//   And   当前处于离线模式（已连续失败达到阈值）
//   When  ping 恢复成功
//   Then  模式切换为 'reconnecting'（触发重连同步）
//   And   失败计数器重置为 0
// ============================================================
test('离线模式下 ping 恢复触发重连', () => {
  // 模拟已处于离线状态
  const state = { mode: MODE.OFFLINE, failCount: 5, wasOnline: true };
  const result = processPingResult(state, true);

  assert.strictEqual(result.mode, MODE.RECONNECTING, '曾在线过应触发重连');
  assert.strictEqual(result.failCount, 0, '计数器应重置');
  assert.strictEqual(result.shouldReconnect, true, '应标记需要重连');
});

// ============================================================
// Scenario 6: 首次启动从未在线过，ping 恢复直接上线
//   Given 孩子端首次启动，从未在线过（wasOnline = false）
//   And   当前处于离线模式
//   When  ping 恢复成功
//   Then  模式切换为 'online'（不走重连流程）
//   And   失败计数器重置为 0
// ============================================================
test('首次启动从未在线，ping 恢复直接上线不重连', () => {
  const state = { mode: MODE.OFFLINE, failCount: 3, wasOnline: false };
  const result = processPingResult(state, true);

  assert.strictEqual(result.mode, MODE.ONLINE, '首次上线应直接进入在线模式');
  assert.strictEqual(result.failCount, 0, '计数器应重置');
  assert.strictEqual(result.shouldReconnect, false, '不应触发重连');
  assert.strictEqual(result.wasOnline, true, 'wasOnline 应标记为 true');
});

// ============================================================
// Scenario 7: 已在重连中，ping 继续失败不改变模式
//   Given 孩子端正在重连（mode = 'reconnecting'）
//   When  ping 失败（但未达阈值）
//   Then  模式保持 'reconnecting'
//   And   不弹出额外的断网提示
// ============================================================
test('重连中 ping 偶发失败不影响重连状态', () => {
  const state = { mode: MODE.RECONNECTING, failCount: 1, wasOnline: true };
  const result = processPingResult(state, false);

  assert.strictEqual(result.mode, MODE.RECONNECTING, '重连中应保持 reconnecting');
  assert.strictEqual(result.shouldToast, false, '不应弹窗');
});

// ============================================================
// RED 测试：直接加载 connection.js 验证 buggy 行为
// ============================================================

/**
 * 加载 connection.js 到 vm 沙箱，mock 所有外部依赖
 */
function loadConnectionManager(options = {}) {
  const mockPingResults = options.pingResults || [true];
  let pingCallCount = 0;

  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="connStatus"></div><div id="reconnectMask"></div></body></html>', {
    url: 'http://localhost',
  });

  const sandbox = {
    document: dom.window.document,
    window: dom.window,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    setInterval: dom.window.setInterval.bind(dom.window),
    clearInterval: dom.window.clearInterval.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    console,
    fetch: async () => {
      const ok = mockPingResults[Math.min(pingCallCount, mockPingResults.length - 1)];
      pingCallCount++;
      if (!ok) {
        // 模拟 ping 立即失败（网络不可达）
        return { ok: false, status: 503, json: async () => ({ ok: false }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    },
    showToast: () => {},
    SyncEngine: { fullSync: async () => {} },
    API: { getData: async () => ({}) },
  };

  // 设置测试配置：缩短超时以加速测试
  sandbox.window.__CM_TEST_CONFIG__ = {
    pingTimeoutMs: options.pingTimeoutMs || 500,
    pingIntervalMs: 100,          // 快速间隔
    reconnectTimeoutMs: 1000,
  };

  vm.createContext(sandbox);

  const connCode = fs.readFileSync(
    path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'connection.js'),
    'utf8'
  );

  vm.runInContext(connCode, sandbox);

  return {
    ConnectionManager: sandbox.ConnectionManager,
    getPingCallCount: () => pingCallCount,
    dom,
    sandbox,
  };
}

// ============================================================
// RED Scenario: 单次 ping 失败不切离线（验证修复后的阈值行为）
//   Given 孩子端已在线
//   When  连续 2 次 ping 失败（未达阈值 3）
//   Then  模式仍为 'online'
//
//   修复前（buggy）：mode = 'offline'（单次失败即切）
//   修复后：mode = 'online'（需要连续 3 次才切）
// ============================================================
test('[RED] 连续 2 次 ping 失败后模式仍为 online（阈值容错）', async () => {
  const { ConnectionManager } = loadConnectionManager({
    // 第 1 次成功上线，第 2、3 次失败
    pingResults: [true, false, false],
    pingTimeoutMs: 500,
  });

  // 启动 CM，第 1 次 ping 成功 → online
  await ConnectionManager.start();

  // 等待 2 次 interval ping（间隔 100ms，等待 250ms 足以触发 2 次）
  await new Promise(r => setTimeout(r, 250));

  const mode = ConnectionManager.getMode();

  // 连续 2 次失败，未达阈值 3，模式应仍为 'online'
  // 修复前（buggy）：这里 mode 会是 'offline'
  assert.notStrictEqual(
    mode,
    'offline',
    '连续 2 次 ping 失败不应切换离线（需要连续 3 次才切）'
  );
  assert.strictEqual(mode, 'online', '模式应保持 online');
});

// ============================================================
// 补充测试：连续 3 次 ping 失败后正确切换离线
// ============================================================
test('连续 3 次 ping 失败后正确切换离线', async () => {
  const { ConnectionManager } = loadConnectionManager({
    pingResults: [true, false, false, false],
    pingTimeoutMs: 500,
  });

  await ConnectionManager.start();

  // 等待 3 次 interval ping（间隔 100ms，350ms 足以触发 3 次）
  await new Promise(r => setTimeout(r, 350));

  const mode = ConnectionManager.getMode();
  assert.strictEqual(mode, 'offline', '连续 3 次 ping 失败应切换为 offline');
});
