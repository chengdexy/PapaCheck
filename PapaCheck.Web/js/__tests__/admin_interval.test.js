/**
 * admin_interval.test.js - admin.js 定时器生命周期测试
 *
 * Feature: admin.js 的刷新定时器必须可清理，避免内存泄漏
 *   Scenario: startRefreshTimer 调用 setInterval 并保存 ID
 *     Given admin.js 已加载
 *     When 调用 startRefreshTimer
 *     Then setInterval 被调用且返回的 ID 已保存
 *
 *   Scenario: stopRefreshTimer 调用 clearInterval
 *     Given startRefreshTimer 已调用
 *     When 调用 stopRefreshTimer
 *     Then clearInterval 被调用且参数为之前保存的 ID
 *
 *   Scenario: 重复调用 startRefreshTimer 不创建多个 interval
 *     Given startRefreshTimer 已调用一次
 *     When 再次调用 startRefreshTimer
 *     Then 旧的 interval 被清理（clearInterval 被调用）
 *     And 新的 interval 被创建
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function createAdminIntervalContext() {
  const commonCode = fs.readFileSync(
    path.join(__dirname, '..', 'common.js'),
    'utf8'
  );
  const adminCode = fs.readFileSync(
    path.join(__dirname, '..', 'admin.js'),
    'utf8'
  );

  let intervalIdCounter = 0;
  const setIntervalCalls = [];
  const clearIntervalCalls = [];
  const eventListeners = {};

  const mockEl = {
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    innerHTML: '',
    textContent: '',
    querySelector: () => null,
    appendChild: () => {},
  };

  const context = vm.createContext({
    document: {
      getElementById: () => mockEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => {
        let _text = '';
        return {
          set textContent(v) { _text = v; },
          get textContent() { return _text; },
          get innerHTML() {
            return String(_text)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
        };
      },
    },
    navigator: { serviceWorker: { register: async () => ({ scope: '' }) } },
    window: {
      addEventListener: (event, handler) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(handler);
      },
    },
    location: { href: '' },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },

    ConnectionManager: {
      getMode: () => 'online',
      start: async () => {},
    },
    API: {
      getData: async () => ({}),
      migrateBountyCompletionsToTotal: () => {},
    },
    DB: {
      cacheFullData: async () => {},
      getFullData: async () => ({}),
    },
    CRDTLog: { append: () => {}, migrateFromChangeLog: async () => {} },

    cachedData: null,
    adminHomeworks: [],
    adminBountyTasks: [],

    console,
    setTimeout: (fn, ms) => { return 1; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => {
      const id = ++intervalIdCounter;
      setIntervalCalls.push({ id, ms });
      return id;
    },
    clearInterval: (id) => {
      clearIntervalCalls.push(id);
    },
    JSON, Error, Object, Array, Math, Date, Map, Set, Promise,
    String, Number, Boolean, RegExp, parseInt, parseFloat,
    isNaN, isFinite, Symbol, WeakMap, WeakSet,
    showTransitionMask: () => {},
    hideTransitionMask: () => {},
  });

  vm.runInContext(commonCode + '\n' + adminCode, context);

  return {
    context,
    setIntervalCalls,
    clearIntervalCalls,
    eventListeners,
  };
}

describe('admin.js 定时器生命周期', () => {
  it('startRefreshTimer 调用 setInterval 并保存 ID', () => {
    const { context, setIntervalCalls } = createAdminIntervalContext();

    expect(typeof context.startRefreshTimer).toBe('function');
    context.startRefreshTimer();

    expect(setIntervalCalls.length).toBe(1);
    expect(setIntervalCalls[0].ms).toBe(5000);
  });

  it('stopRefreshTimer 调用 clearInterval', () => {
    const { context, setIntervalCalls, clearIntervalCalls } = createAdminIntervalContext();

    context.startRefreshTimer();
    expect(setIntervalCalls.length).toBe(1);
    const savedId = setIntervalCalls[0].id;

    context.stopRefreshTimer();
    expect(clearIntervalCalls.length).toBe(1);
    expect(clearIntervalCalls[0]).toBe(savedId);
  });

  it('重复调用 startRefreshTimer 先清理旧 interval', () => {
    const { context, setIntervalCalls, clearIntervalCalls } = createAdminIntervalContext();

    context.startRefreshTimer();
    const firstId = setIntervalCalls[0].id;

    context.startRefreshTimer();

    // 旧 interval 应被清理
    expect(clearIntervalCalls).toContain(firstId);
    // 新 interval 应被创建
    expect(setIntervalCalls.length).toBe(2);
  });

  it('beforeunload 事件触发时清理 interval', () => {
    const { context, setIntervalCalls, clearIntervalCalls, eventListeners } = createAdminIntervalContext();

    context.startRefreshTimer();
    const savedId = setIntervalCalls[0].id;

    // 模拟 beforeunload 事件
    expect(eventListeners.beforeunload).toBeDefined();
    expect(eventListeners.beforeunload.length).toBeGreaterThan(0);
    eventListeners.beforeunload[0]();

    expect(clearIntervalCalls).toContain(savedId);
  });
});
