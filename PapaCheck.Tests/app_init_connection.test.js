/**
 * test_app_init_connection.js
 *
 * Feature: app.js 初始化使用 ConnectionManager 判断在线/离线
 *   重构 app.js 的 init() 函数，使其与 admin.js 的 initAdmin() 保持一致：
 *   先启动 ConnectionManager 检测连接，再根据模式决定数据来源，
 *   而不是在 init() 中用 try/catch 自行判断在线/离线。
 */

import { test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ============================================================
// 辅助函数：加载 app.js 到 vm 沙箱，mock 所有外部依赖
// ============================================================

function createAppSandbox(options = {}) {
  const {
    cmMode = 'online',
    apiData = { points: { balance: 100 }, homeworks: {}, bountyTasks: [], shopItems: [], rewardBox: [], activeBuffs: [] },
    apiThrows = false,
    dbData = { points: { balance: 50 }, homeworks: {} },
    dbThrows = false,
    cmStartDelay = 0,
  } = options;

  // 追踪调用顺序
  const callOrder = [];
  let apiGetDataCalled = false;
  let dbGetFullDataCalled = false;
  let cmStartCalled = false;

  const sandbox = {
    // DOM
    document: {
      getElementById: (id) => {
        if (id === 'bigMode') return { innerHTML: '', style: {} };
        if (id === 'connStatus') return { textContent: '', className: '', title: '' };
        if (id === 'bigDate') return { textContent: '' };
        if (id === 'bigTime') return { textContent: '' };
        if (id === 'toast') return { textContent: '', classList: { add: () => { }, remove: () => { } } };
        if (id === 'saverTime') return { textContent: '' };
        if (id === 'saverDate') return { textContent: '' };
        if (id === 'screenSaver') return { classList: { add: () => { }, remove: () => { } } };
        if (id === 'transitionMask') return { style: { display: 'none' } };
        if (id === 'transitionText') return { textContent: '' };
        if (id === 'reconnectMask') return { style: { display: 'none' } };
        if (id === 'bigHeader') return {};
        if (id === 'bigContent') return {};
        if (id === 'leftColumn') return {};
        if (id === 'rightColumn') return {};
        if (id === 'currentTaskCard') return {};
        if (id === 'currentTaskDisplay') return {};
        if (id === 'bigStats') return {};
        if (id === 'homeworkCard') return {};
        if (id === 'homeworkGrid') return {};
        if (id === 'freeTimeCard') return { style: { display: 'none' } };
        if (id === 'freeTimeGrid') return {};
        if (id === 'buffBar') return { style: { display: 'none' } };
        if (id === 'settlementContainer') return { style: { display: 'none' } };
        if (id === 'ratedContainer') return { style: { display: 'none' } };
        if (id === 'shopContainer') return { style: { display: 'none' } };
        return { style: {}, classList: { add: () => { }, remove: () => { } }, addEventListener: () => { } };
      },
      addEventListener: () => { },
      createElement: () => ({ textContent: '', innerHTML: '', appendChild: () => { } }),
      querySelector: () => ({ textContent: '', classList: { add: () => { }, remove: () => { }, toggle: () => { } } }),
      querySelectorAll: () => [],
    },
    window: {
      AudioContext: undefined,
      webkitAudioContext: undefined,
      addEventListener: () => { },
    },
    navigator: {
      serviceWorker: undefined,
    },

    // Timers (prevent actual timers from running)
    setTimeout: (fn, ms) => { return 1; },
    setInterval: (fn, ms) => { return 1; },
    clearTimeout: () => { },
    clearInterval: () => { },

    // Console
    console: { log: () => { }, error: () => { }, warn: () => { }, info: () => { } },

    // ConnectionManager - mock that returns configured mode
    ConnectionManager: {
      getMode: () => cmMode,
      start: async () => {
        cmStartCalled = true;
        callOrder.push('cmStart');
        if (cmStartDelay > 0) {
          await new Promise(r => setTimeout(r, cmStartDelay));
        }
      },
      stop: () => { },
    },

    // API - mock with spy
    API: {
      getData: async () => {
        apiGetDataCalled = true;
        callOrder.push('apiGetData');
        if (apiThrows) throw new Error('network error');
        return JSON.parse(JSON.stringify(apiData));
      },
      migrateBountyCompletionsToTotal: (data) => data,
      saveHomeworks: async () => { },
      saveFreeTime: async () => { },
      saveSettlement: async () => { },
      saveActiveBuffs: async () => { },
      saveSettings: async () => { },
    },

    // DB - mock with spy
    DB: {
      getFullData: async () => {
        dbGetFullDataCalled = true;
        callOrder.push('dbGetFullData');
        if (dbThrows) throw new Error('db error');
        return JSON.parse(JSON.stringify(dbData));
      },
      cacheFullData: async () => { },
    },

    // Other globals
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    showToast: () => { },
    showTransitionMask: () => { },
    hideTransitionMask: () => { },
    hideReconnectMask: () => { },
    showReconnectMask: () => { },
    updateConnStatus: () => { },
    updateBigScreen: () => { },
    backToMain: () => { },
    startPoll: () => { },
    stopPoll: () => { },
    startTickTimer: () => { },
    stopTickTimer: () => { },
    startScreenSaverTimer: () => { },
    showShopPage: () => { },
    showMyRewards: () => { },
    JSON,
    Error,
    Object,
    Array,
    Math,
    Date,
    Map,
    Set,
    Promise,
    Symbol,
    URL: class { constructor(url) { this.href = url; } toString() { return this.href; } },
  };

  const ctx = vm.createContext(sandbox);

  // Load dependency: db.js (stubbed - already mocked above)
  // Load dependency: api.js (needs to be loaded for API definitions used by app.js)
  // Actually, we've fully mocked API above, so we just need to load app.js

  // Load app.js
  const appCode = fs.readFileSync(
    path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'app.js'),
    'utf8'
  );

  vm.runInContext(appCode, ctx);

  return {
    sandbox: ctx,
    getCallOrder: () => callOrder.slice(),
    getApiGetDataCalled: () => apiGetDataCalled,
    getDbGetFullDataCalled: () => dbGetFullDataCalled,
    getCmStartCalled: () => cmStartCalled,
    getBigModeHtml: () => {
      const el = sandbox.document.getElementById('bigMode');
      if (el._mockInnerHTML !== undefined) return el._mockInnerHTML;
      return sandbox._bigModeHtml || '';
    },
  };
}

// ============================================================
// Feature: app.js 初始化使用 ConnectionManager 判断在线/离线
// ============================================================

//   Scenario: 服务器在线时，init() 通过 API 获取数据
//     Given ConnectionManager.start() 返回在线模式
//     When 调用 init() 初始化
//     Then 设置 isServerMode 为 true
//     And 调用 API.getData() 获取服务端数据
//     And 正常渲染大屏界面
test('服务器在线时通过 API 获取数据', async () => {
  // RED: 当前 init() 在 CM.start() 之前就调用 API.getData()
  // 期望：CM.start() 应先于 API.getData() 被调用
  const ctx = createAppSandbox({
    cmMode: 'online',
  });

  // init() 是异步的（在 app.js 底部自动调用）
  // 等待异步完成
  await new Promise(r => setTimeout(r, 200));

  const callOrder = ctx.getCallOrder();
  const cmStartIdx = callOrder.indexOf('cmStart');
  const apiGetDataIdx = callOrder.indexOf('apiGetData');

  // 重构后期望：CM.start() 必须在 API.getData() 之前调用
  assert.ok(ctx.getCmStartCalled(), 'CM.start() 应该被调用');
  assert.ok(ctx.getApiGetDataCalled(), 'API.getData() 应该被调用');
  assert.ok(
    cmStartIdx >= 0 && apiGetDataIdx >= 0 && cmStartIdx < apiGetDataIdx,
    'CM.start() 应在 API.getData() 之前调用'
  );

  // DB.getFullData() 在线模式下不应被调用
  assert.ok(!ctx.getDbGetFullDataCalled(), '在线模式不应调用 DB.getFullData()');
});

//   Scenario: 服务器离线但有本地缓存时，init() 通过 DB 获取数据
//     Given ConnectionManager.start() 返回离线模式
//     And 本地 localforage 有缓存数据
//     When 调用 init() 初始化
//     Then 设置 isServerMode 为 false
//     And 调用 DB.getFullData() 获取本地缓存数据
//     And 正常渲染大屏界面
//     And 显示离线模式提示
test('服务器离线但有本地缓存时通过 DB 获取数据', async () => {
  const ctx = createAppSandbox({
    cmMode: 'offline',
    dbData: { points: { balance: 50 }, homeworks: {} },
  });

  await new Promise(r => setTimeout(r, 200));

  // 重构后期望：
  // 1. CM.start() 先调用
  // 2. 离线模式不调用 API.getData()
  // 3. 直接调用 DB.getFullData()
  assert.ok(ctx.getCmStartCalled(), 'CM.start() 应该被调用');
  assert.ok(ctx.getDbGetFullDataCalled(), 'DB.getFullData() 应该被调用');

  // RED 断言：离线模式下不应调用 API.getData()
  // 当前代码：会先调用 API.getData()（即使离线），失败后才降级到 DB
  assert.ok(
    !ctx.getApiGetDataCalled(),
    '离线模式不应调用 API.getData()（当前代码会调用，期望 RED）'
  );
});

//   Scenario: 服务器离线且无本地缓存时，显示"未连接服务器"界面
//     Given ConnectionManager.start() 返回离线模式
//     And 本地 localforage 无缓存数据
//     When 调用 init() 初始化
//     Then 显示"未连接服务器"界面
//     And init() 返回（不渲染大屏界面）
test('服务器离线且无本地缓存时显示未连接服务器界面', async () => {
  const ctx = createAppSandbox({
    cmMode: 'offline',
    dbData: {},  // 空缓存
  });

  await new Promise(r => setTimeout(r, 200));

  // 重构后期望：离线 + 无缓存 → 显示"未连接服务器"界面
  // 当前代码：会先调用 API.getData()，失败后尝试 DB.getFullData()
  // API.getData() 内部会用 DB 兜底，DB 返回空 → API.getData() 抛异常
  // init() catch 再尝试 DB.getFullData()，也返回空 → 显示"未连接服务器"

  // RED 断言：离线模式下不应调用 API.getData()
  assert.ok(
    !ctx.getApiGetDataCalled(),
    '离线 + 无缓存模式不应调用 API.getData()（当前代码会调用，期望 RED）'
  );
});
