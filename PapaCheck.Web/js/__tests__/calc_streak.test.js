/**
 * calc_streak.test.js - 连续全勤计算逻辑测试
 *
 * Feature: calcStreak 连续全勤天数
 *   Scenario: 有多个作业日且评级均为有效
 *     Given dailySettlement 中有 5 个日期，评级均有效（不为'差'）
 *     When calcStreak 被调用
 *     Then 应返回 5（全部计入连续全勤）
 *
 *   Scenario: 中间日期无评级（未评级）
 *     Given dailySettlement 最近的日期尚未评级，先前日期均为有效评级
 *     When calcStreak 被调用
 *     Then 应跳过未评级日期，从最近的有效评级日期开始计数
 *
 *   Scenario: 评级为'差'中断连续
 *     Given dailySettlement 最新的有效评级之后有一个'差'评级
 *     When calcStreak 被调用
 *     Then 应在'差'评级处中断，只计数之前的有效评级
 *
 *   Scenario: 有日历缺口（周末无作业）
 *     Given dailySettlement 中日期有跳跃（中间几天无记录）
 *     When calcStreak 被调用
 *     Then 应按有记录日期计数，不被日历缺口中断
 *
 *   Scenario: 今日未评级但昨日有有效评级
 *     Given 今日无 settlement，昨日有有效评级
 *     When calcStreak 被调用
 *     Then 应跳过今日，从昨日开始计数
 */

import { describe, test, assert, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== 测试工具 ==========

let _dateNow = Date.now();
const _origDate = globalThis.Date;

/** 模拟日期，让 new Date() 返回固定日期 */
function mockDate(dateStr) {
    const now = new Date(dateStr).getTime();
    _dateNow = now;
    globalThis.Date = class extends _origDate {
        constructor(...args) {
            if (args.length === 0) super(now);
            else super(...args);
        }
        static now() { return now; }
    };
}

function restoreDate() {
    globalThis.Date = _origDate;
}

function createMockDoc() {
    const elements = {};
    return {
        getElementById: (id) => elements[id] || null,
        _setElement: (id, el) => { elements[id] = el; },
        createElement: () => ({
            textContent: '',
            innerHTML: '',
            classList: { add: () => { }, remove: () => { }, toggle: () => { } },
            addEventListener: () => { },
            style: {},
            appendChild: () => { },
            dataset: {},
        }),
        querySelectorAll: () => ({ forEach: (fn) => { } }),
        querySelector: () => null,
    };
}

function loadAdminInVM(mocks) {
    const commonCode = fs.readFileSync(
        path.join(__dirname, '..', 'common.js'),
        'utf8'
    );
    const adminCode = fs.readFileSync(
        path.join(__dirname, '..', 'admin.js'),
        'utf8'
    );

    const doc = createMockDoc();
    doc._setElement('transitionMask', { style: { display: 'none' } });
    doc._setElement('transitionText', { textContent: '' });
    doc._setElement('adminDate', { textContent: '' });
    doc._setElement('adminModal', { classList: { add: () => { }, remove: () => { } }, addEventListener: () => { } });
    doc._setElement('toast', {
        textContent: '',
        classList: { add: () => { }, remove: () => { } },
    });
    doc._setElement('adminContent', { innerHTML: '' });

    const context = vm.createContext({
        document: doc,
        navigator: { serviceWorker: { register: async () => ({ scope: '' }) } },
        window: { addEventListener: () => { } },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        location: { href: '' },
        localStorage: { getItem: () => null, setItem: () => { } },

        ConnectionManager: {
            getMode: () => 'online',
            start: async () => { },
            ...(mocks.ConnectionManager || {}),
        },
        API: {
            getData: async() => ({}),
            migrateBountyCompletionsToTotal: () => {},
            ...mocks.API,
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
        setTimeout,
        clearTimeout,
        setInterval: () => ({}),
        JSON,
        Error,
        Object,
        Array,
        Math,
        Date,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        RegExp,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        Symbol,
        WeakMap,
        WeakSet,
        showTransitionMask: () => {},
        hideTransitionMask: () => {},
    });

    vm.runInContext(commonCode + '\n' + adminCode, context, { timeout: 5000 });
    return context;
}

// ========== 测试 ==========

describe('calcStreak 连续全勤天数', () => {
    let ctx;

    beforeAll(() => {
        // 固定日期为 2026-06-10
        mockDate('2026-06-10T12:00:00Z');
    });

    afterAll(() => {
        restoreDate();
    });

    // Scenario: 有日历缺口（周末无作业）
    //   Given dailySettlement 中日期有跳跃（中间几天无记录）
    //   When calcStreak 被调用
    //   Then 应按有记录日期计数，不被日历缺口中断
    test('有日历缺口时按有记录日期计数，不被中断', () => {
        ctx = loadAdminInVM({});
        ctx.cachedData = {
            dailySettlement: {
                '2026-06-10': { rating: '优' },
                // 6月9日无记录（缺口）
                '2026-06-08': { rating: '良' },
                '2026-06-05': { rating: '优' },
                '2026-06-04': { rating: '良' },
            },
        };

        const allDates = Object.keys(ctx.cachedData.dailySettlement).sort();
        const result = ctx.calcStreak(allDates);

        assert.strictEqual(result, 4, '日历缺口不应中断连续全勤计数');
    });

    // Scenario: 评级为'差'中断连续
    //   Given dailySettlement 最新的有效评级之后有一个'差'评级
    //   When calcStreak 被调用
    //   Then 应在'差'评级处中断，只计数之前的有效评级
    test('评级为差中断连续', () => {
        ctx = loadAdminInVM({});
        ctx.cachedData = {
            dailySettlement: {
                '2026-06-10': { rating: '优' },
                '2026-06-09': { rating: '良' },
                '2026-06-08': { rating: '差' },
                '2026-06-07': { rating: '优' },
                '2026-06-06': { rating: '优' },
            },
        };

        const allDates = Object.keys(ctx.cachedData.dailySettlement).sort();
        const result = ctx.calcStreak(allDates);

        assert.strictEqual(result, 2, '评级为差应中断连续，只计中断前的有效评级');
    });

    // Scenario: 今日未评级但昨日有有效评级
    //   Given 今日无 settlement，昨日有有效评级
    //   When calcStreak 被调用
    //   Then 应跳过今日，从昨日开始计数
    test('今日未评级时从昨日开始计数', () => {
        ctx = loadAdminInVM({});
        ctx.cachedData = {
            dailySettlement: {
                '2026-06-10': { rating: null }, // 今日未评级
                '2026-06-09': { rating: '优' },
                '2026-06-08': { rating: '良' },
                '2026-06-07': { rating: '优' },
            },
        };

        const allDates = Object.keys(ctx.cachedData.dailySettlement).sort();
        const result = ctx.calcStreak(allDates);

        assert.strictEqual(result, 3, '今日未评级时应跳过今日从昨日开始计数');
    });

    // Scenario: 空数据
    //   Given dailySettlement 为空
    //   When calcStreak 被调用
    //   Then 应返回 0
    test('空数据返回 0', () => {
        ctx = loadAdminInVM({});

        const result = ctx.calcStreak([]);

        assert.strictEqual(result, 0, '空数据应返回 0');
    });

    // Scenario: 全部有效连续
    //   Given 所有日期评级均有效
    //   When calcStreak 被调用
    //   Then 应返回全部日期数
    test('全部有效连续返回正确值', () => {
        ctx = loadAdminInVM({});
        ctx.cachedData = {
            dailySettlement: {
                '2026-06-10': { rating: '优' },
                '2026-06-09': { rating: '良' },
                '2026-06-08': { rating: '优' },
                '2026-06-07': { rating: '可' },
                '2026-06-06': { rating: '优' },
            },
        };

        const allDates = Object.keys(ctx.cachedData.dailySettlement).sort();
        const result = ctx.calcStreak(allDates);

        assert.strictEqual(result, 5, '全部有效应返回全部日期数');
    });
});
