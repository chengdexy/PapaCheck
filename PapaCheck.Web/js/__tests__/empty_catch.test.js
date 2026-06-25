/**
 * empty_catch.test.js - 空 catch 块日志测试
 *
 * Feature: api.js 中的 catch 块应记录警告日志，不应静默吞没错误
 *   Scenario: getData 中 DB.cacheFullData 失败时 console.warn 被调用
 *     Given fetch 返回成功响应
 *     And DB.cacheFullData 抛出错误
 *     When 调用 API.getData()
 *     Then console.warn 被调用
 *
 *   Scenario: online-first 策略中 offlineFn 失败时 console.warn 被调用
 *     Given ConnectionManager 模式为 online
 *     And onlineFn 成功返回
 *     And offlineFn 抛出错误
 *     When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { syncToLocal: true })
 *     Then console.warn 被调用
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function createApiContext(options = {}) {
  const apiCode = fs.readFileSync(
    path.join(__dirname, '..', 'api.js'),
    'utf8'
  );

  const warnSpy = vi.fn();

  const mockDB = {
    cacheFullData: options.cacheFullDataThrows
      ? async () => { throw new Error('cache failed'); }
      : async () => {},
    getFullData: async () => ({}),
    getHomeworks: async () => [],
    saveHomeworks: async () => {},
    getSettlement: async () => ({}),
    saveSettlement: async () => {},
    getRedemptions: async () => [],
    saveRedemptions: async () => {},
    getRewardBox: async () => [],
    saveRewardBox: async () => {},
    getSettings: async () => ({}),
    saveSettings: async () => {},
    getActiveBuffs: async () => [],
    saveActiveBuffs: async () => {},
    getShopItems: async () => [],
    saveShopItems: async () => {},
    getEfficiency: async () => ({}),
    saveEfficiency: async () => {},
    getFreeTime: async () => [],
    saveFreeTime: async () => {},
    getBountyTasks: async () => [],
    saveBountyTasks: async () => {},
    getBountySubmissions: async () => [],
    saveBountySubmissions: async () => {},
    getBountyCompletions: async () => ({}),
    saveBountyCompletions: async () => {},
    getPoints: async () => ({ balance: 0, history: [] }),
    savePoints: async () => {},
  };

  const context = vm.createContext({
    ConnectionManager: {
      getMode: () => options.mode || 'online',
    },
    DB: mockDB,
    fetch: options.fetch || (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true, data: {} }),
    })),
    document: { getElementById: () => null },
    window: {},
    console: { ...console, warn: warnSpy },
    setTimeout,
    clearTimeout,
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
  });

  const wrappedCode = apiCode
    .replace(/^let isServerMode/m, 'var isServerMode')
    .replace(/^let cachedData/m, 'var cachedData')
    .replace(/^const API = \{/m, 'var API = {');

  vm.runInContext(wrappedCode, context);

  return { context, warnSpy };
}

describe('api.js 空 catch 块日志', () => {
  it('getData 中 DB.cacheFullData 失败时 console.warn 被调用', async () => {
    const { context, warnSpy } = createApiContext({
      cacheFullDataThrows: true,
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, homeworks: [] }),
      }),
    });

    await context.API.getData();

    expect(warnSpy).toHaveBeenCalled();
  });

  it('online-first 策略中 offlineFn 失败时 console.warn 被调用', async () => {
    const { context, warnSpy } = createApiContext({ mode: 'online' });

    await context.API._requestWithStrategy(
      'online-first',
      async () => 'online-result',
      async () => { throw new Error('offline failed'); },
      { allowFallback: true, syncToLocal: true }
    );

    expect(warnSpy).toHaveBeenCalled();
  });
});
