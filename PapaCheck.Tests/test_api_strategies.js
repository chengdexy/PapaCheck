/**
 * test_api_strategies.js - API 请求策略单元测试
 *
 * 测试 PapaCheck.Web/js/api.js 中 _requestWithStrategy 统一请求策略处理器
 */

import { describe, test, assert, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== 加载 api.js 并注入 mock ==========

function createTestContext(connMode) {
    const apiCode = fs.readFileSync(
        path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'api.js'),
        'utf8'
    );

    // Mock 依赖
    const mockDB = {
        cacheFullData: async () => { },
        getFullData: async () => ({}),
        getHomeworks: async () => [],
        saveHomeworks: async () => { },
        getSettlement: async () => ({}),
        saveSettlement: async () => { },
        getRedemptions: async () => [],
        saveRedemptions: async () => { },
        getRewardBox: async () => [],
        saveRewardBox: async () => { },
        getSettings: async () => ({}),
        saveSettings: async () => { },
        getActiveBuffs: async () => [],
        saveActiveBuffs: async () => { },
        getShopItems: async () => [],
        saveShopItems: async () => { },
        getEfficiency: async () => ({}),
        saveEfficiency: async () => { },
        getFreeTime: async () => [],
        saveFreeTime: async () => { },
        getBountyTasks: async () => [],
        saveBountyTasks: async () => { },
        getBountySubmissions: async () => [],
        saveBountySubmissions: async () => { },
        getBountyCompletions: async () => ({}),
        saveBountyCompletions: async () => { },
        getPoints: async () => ({ balance: 0, history: [] }),
        savePoints: async () => { },
    };

    const mockConnectionManager = {
        getMode: () => connMode,
    };

    const mockFetch = async (url, options) => {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true }) };
    };

    const mockDocument = {
        getElementById: () => null,
    };

    const context = vm.createContext({
        ConnectionManager: mockConnectionManager,
        DB: mockDB,
        fetch: mockFetch,
        document: mockDocument,
        console,
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

    // Wrap api.js code to expose `const` declarations as context globals
    const wrappedCode = apiCode
        .replace(/^let isServerMode/m, 'var isServerMode')
        .replace(/^let cachedData/m, 'var cachedData')
        .replace(/^const API = \{/m, 'var API = {');

    vm.runInContext(wrappedCode, context);
    return context;
}

// ========== Feature: online-first 策略 ==========

describe('online-first 策略', () => {
    // Scenario: 在线模式下在线请求成功时返回在线结果
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { allowFallback: true })
    //   And onlineFn 成功返回结果
    //   Then 返回 onlineFn 的结果
    test('在线模式下在线请求成功时返回在线结果', async () => {
        const ctx = createTestContext('online');
        const result = await ctx.API._requestWithStrategy(
            'online-first',
            async () => 'online-result',
            async () => 'offline-result',
            { allowFallback: true }
        );
        assert.equal(result, 'online-result');
    });

    // Scenario: 在线模式下在线请求失败时降级到离线函数
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { allowFallback: true })
    //   And onlineFn 抛出异常
    //   Then 返回 offlineFn 的结果
    test('在线模式下在线请求失败时降级到离线函数', async () => {
        const ctx = createTestContext('online');
        const result = await ctx.API._requestWithStrategy(
            'online-first',
            async () => { throw new Error('network error'); },
            async () => 'offline-result',
            { allowFallback: true }
        );
        assert.equal(result, 'offline-result');
    });

    // Scenario: 在线模式下在线请求失败且不允许降级时抛出异常
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { allowFallback: false })
    //   And onlineFn 抛出异常
    //   Then 抛出 onlineFn 的异常
    test('在线模式下在线请求失败且不允许降级时抛出异常', async () => {
        const ctx = createTestContext('online');
        await expect(
            ctx.API._requestWithStrategy(
                'online-first',
                async () => { throw new Error('network error'); },
                async () => 'offline-result',
                { allowFallback: false }
            )
        ).rejects.toThrow('network error');
    });

    // Scenario: 离线模式下直接调用离线函数
    //   Given ConnectionManager 模式为 offline
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { allowFallback: true })
    //   Then 不调用 onlineFn，直接返回 offlineFn 的结果
    test('离线模式下直接调用离线函数', async () => {
        const ctx = createTestContext('offline');
        let onlineCalled = false;
        const result = await ctx.API._requestWithStrategy(
            'online-first',
            async () => { onlineCalled = true; return 'online-result'; },
            async () => 'offline-result',
            { allowFallback: true }
        );
        assert.equal(result, 'offline-result');
        assert.equal(onlineCalled, false);
    });

    // Scenario: 在线请求成功且 syncToLocal 为 true 时同步调用离线函数
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { syncToLocal: true })
    //   And onlineFn 成功返回结果
    //   Then 先返回 onlineFn 的结果，然后调用 offlineFn 同步到本地
    test('在线请求成功且 syncToLocal 为 true 时同步调用离线函数', async () => {
        const ctx = createTestContext('online');
        let offlineCalled = false;
        const result = await ctx.API._requestWithStrategy(
            'online-first',
            async () => 'online-result',
            async () => { offlineCalled = true; },
            { syncToLocal: true }
        );
        assert.equal(result, 'online-result');
        assert.equal(offlineCalled, true);
    });

    // Scenario: 在线请求失败时调用 onOnlineError 回调
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, { allowFallback: true, onOnlineError: callback })
    //   And onlineFn 抛出异常
    //   Then 调用 onOnlineError 回调并传入错误对象，然后降级到 offlineFn
    test('在线请求失败时调用 onOnlineError 回调', async () => {
        const ctx = createTestContext('online');
        let capturedError = null;
        const result = await ctx.API._requestWithStrategy(
            'online-first',
            async () => { throw new Error('network error'); },
            async () => 'offline-result',
            {
                allowFallback: true,
                onOnlineError: (err) => { capturedError = err; },
            }
        );
        assert.equal(result, 'offline-result');
        assert.ok(capturedError);
        assert.equal(capturedError.message, 'network error');
    });
});

// ========== Feature: online-only 策略 ==========

describe('online-only 策略', () => {
    // Scenario: 在线模式下执行在线请求
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-only', onlineFn, offlineFn, {})
    //   Then 返回 onlineFn 的结果
    test('在线模式下执行在线请求', async () => {
        const ctx = createTestContext('online');
        const result = await ctx.API._requestWithStrategy(
            'online-only',
            async () => 'online-result',
            async () => 'offline-result',
            {}
        );
        assert.equal(result, 'online-result');
    });

    // Scenario: 离线模式下抛出错误
    //   Given ConnectionManager 模式为 offline
    //   When 调用 _requestWithStrategy('online-only', onlineFn, offlineFn, {})
    //   Then 抛出错误"当前为离线模式，无法完成此操作"
    test('离线模式下抛出错误', async () => {
        const ctx = createTestContext('offline');
        await expect(
            ctx.API._requestWithStrategy(
                'online-only',
                async () => 'online-result',
                async () => 'offline-result',
                {}
            )
        ).rejects.toThrow('当前为离线模式，无法完成此操作');
    });
});

// ========== Feature: offline-only 策略 ==========

describe('offline-only 策略', () => {
    // Scenario: 始终调用离线函数
    //   Given 任意连接模式
    //   When 调用 _requestWithStrategy('offline-only', onlineFn, offlineFn, {})
    //   Then 返回 offlineFn 的结果，不调用 onlineFn
    test('始终调用离线函数', async () => {
        const ctx = createTestContext('online');
        let onlineCalled = false;
        const result = await ctx.API._requestWithStrategy(
            'offline-only',
            async () => { onlineCalled = true; return 'online-result'; },
            async () => 'offline-result',
            {}
        );
        assert.equal(result, 'offline-result');
        assert.equal(onlineCalled, false);
    });
});

// ========== Feature: _requestWithStrategy 调度 ==========

describe('_requestWithStrategy 调度', () => {
    // Scenario: 未知策略名时回退到 online-first
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('unknown-strategy', onlineFn, offlineFn, { allowFallback: true })
    //   Then 使用 online-first 策略执行
    test('未知策略名时回退到 online-first', async () => {
        const ctx = createTestContext('online');
        const result = await ctx.API._requestWithStrategy(
            'unknown-strategy',
            async () => 'online-result',
            async () => 'offline-result',
            { allowFallback: true }
        );
        assert.equal(result, 'online-result');
    });

    // Scenario: options 为 null 时使用空对象
    //   Given ConnectionManager 模式为 online
    //   When 调用 _requestWithStrategy('online-first', onlineFn, offlineFn, null)
    //   Then 不抛出 TypeError，正常执行
    test('options 为 null 时使用空对象', async () => {
        const ctx = createTestContext('online');
        // online-first with null options: onlineFn succeeds, no allowFallback → should work
        const result = await ctx.API._requestWithStrategy(
            'online-first',
            async () => 'online-result',
            async () => 'offline-result',
            null
        );
        assert.equal(result, 'online-result');
    });
});

// ========== Feature: _fetch 封装 ==========

describe('_fetch 封装', () => {
    // Scenario: 成功请求时返回 JSON 数据
    //   Given fetch 返回 ok=true, status=200, JSON={ ok: true }
    //   When 调用 _fetch('/api/ping')
    //   Then 返回解析后的 JSON 对象
    test('成功请求时返回 JSON 数据', async () => {
        const ctx = createTestContext('online');
        // Override fetch in context
        ctx.fetch = async (url, options) => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ ok: true, data: 'test' }),
        });
        const result = await ctx.API._fetch('/api/ping');
        assert.deepEqual(result, { ok: true, data: 'test' });
    });

    // Scenario: 请求失败时抛出错误
    //   Given fetch 返回 ok=false, statusText='Internal Server Error'
    //   When 调用 _fetch('/api/error')
    //   Then 抛出 Error，message 为 statusText
    test('请求失败时抛出错误', async () => {
        const ctx = createTestContext('online');
        ctx.fetch = async (url, options) => ({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ error: 'fail' }),
        });
        await expect(ctx.API._fetch('/api/error')).rejects.toThrow('Internal Server Error');
    });
});

// ========== Feature: getData 初始化函数 ==========

describe('getData 初始化函数', () => {
    // Scenario: 服务器在线时直接获取数据成功
    //   Given fetch 返回成功响应
    //   When 调用 API.getData()
    //   Then 返回服务器数据，isServerMode 为 true
    test('服务器在线时直接获取数据成功', async () => {
        const ctx = createTestContext('offline'); // 即使 CM 模式为 offline
        ctx.fetch = async (url, options) => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ points: { balance: 100 }, homeworks: {} }),
        });
        const result = await ctx.API.getData();
        assert.ok(result);
        assert.equal(result.points.balance, 100);
        assert.equal(ctx.isServerMode, true);
    });

    // Scenario: 服务器不可用时降级到本地数据
    //   Given fetch 抛出异常
    //   And DB.getFullData 返回本地数据
    //   When 调用 API.getData()
    //   Then 返回本地数据，isServerMode 为 false
    test('服务器不可用时降级到本地数据', async () => {
        const ctx = createTestContext('offline');
        ctx.fetch = async () => { throw new Error('network error'); };
        ctx.DB.getFullData = async () => ({ points: { balance: 50 }, homeworks: {} });
        const result = await ctx.API.getData();
        assert.ok(result);
        assert.equal(result.points.balance, 50);
        assert.equal(ctx.isServerMode, false);
    });

    // Scenario: 服务器不可用且本地无数据时抛出异常
    //   Given fetch 抛出异常
    //   And DB.getFullData 返回空对象
    //   When 调用 API.getData()
    //   Then 抛出原始网络错误
    test('服务器不可用且本地无数据时抛出异常', async () => {
        const ctx = createTestContext('offline');
        ctx.fetch = async () => { throw new Error('network error'); };
        ctx.DB.getFullData = async () => ({});
        await expect(ctx.API.getData()).rejects.toThrow('network error');
    });
});

// ========== Feature: resetDate 使用 online-only 策略 ==========

describe('resetDate', () => {
    // Scenario: 离线模式下 resetDate 抛出错误
    //   Given ConnectionManager 模式为 offline
    //   When 调用 API.resetDate('2026-06-03')
    //   Then 抛出错误"当前为离线模式，无法完成此操作"
    test('离线模式下 resetDate 抛出错误', async () => {
        const ctx = createTestContext('offline');
        await expect(ctx.API.resetDate('2026-06-03')).rejects.toThrow('当前为离线模式，无法完成此操作');
    });
});

// ========== Feature: migrateBountyCompletionsToTotal 纯函数 ==========

describe('migrateBountyCompletionsToTotal', () => {
    // Scenario: 汇总各日期的赏金完成次数到 _total
    //   Given 数据包含多个日期的 bountyCompletions
    //   When 调用 migrateBountyCompletionsToTotal(data)
    //   Then 在 data.bountyCompletions 中添加 _total 字段，值为各 taskId 的累计次数
    test('汇总各日期的赏金完成次数到 _total', async () => {
        const ctx = createTestContext('online');
        const data = {
            bountyCompletions: {
                '2026-06-01': { task1: 2, task2: 1 },
                '2026-06-02': { task1: 1, task3: 3 },
            },
        };
        const result = ctx.API.migrateBountyCompletionsToTotal(data);
        assert.ok(result.bountyCompletions._total);
        assert.equal(result.bountyCompletions._total.task1, 3);
        assert.equal(result.bountyCompletions._total.task2, 1);
        assert.equal(result.bountyCompletions._total.task3, 3);
    });

    // Scenario: 数据为空时原样返回
    //   Given data 为 null
    //   When 调用 migrateBountyCompletionsToTotal(null)
    //   Then 返回 null
    test('数据为空时原样返回', async () => {
        const ctx = createTestContext('online');
        assert.equal(ctx.API.migrateBountyCompletionsToTotal(null), null);
    });

    // Scenario: 已有 _total 时不重复计算
    //   Given data.bountyCompletions 已包含 _total 字段
    //   When 调用 migrateBountyCompletionsToTotal(data)
    //   Then 直接返回 data，不修改 _total
    test('已有 _total 时不重复计算', async () => {
        const ctx = createTestContext('online');
        const data = {
            bountyCompletions: {
                _total: { task1: 999 },
                '2026-06-01': { task1: 2 },
            },
        };
        const result = ctx.API.migrateBountyCompletionsToTotal(data);
        assert.equal(result.bountyCompletions._total.task1, 999);
    });
});
