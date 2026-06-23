/**
 * test_admin_delete_homework.js - 管理端删除作业/赏金任务测试
 *
 * 验证 deleteAdminHw 和 deleteBountyTask 调用正确的 DELETE API
 * 而非错误的 PUT API
 */

import { describe, test, assert, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== 加载 admin.js ==========

function createMockDoc() {
    const elements = {};
    return {
        getElementById: (id) => elements[id] || null,
        _setElement: (id, el) => { elements[id] = el; },
        createElement: () => ({
            textContent: '',
            innerHTML: '',
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            addEventListener: () => {},
            style: {},
            appendChild: () => {},
            dataset: {},
        }),
        querySelectorAll: () => ({
            forEach: (fn) => {},
        }),
        querySelector: () => null,
    };
}

function loadAdminInVM(mocks) {
    const adminCode = fs.readFileSync(
        path.join(__dirname, '..', 'admin.js'),
        'utf8'
    );

    const doc = createMockDoc();
    // 预置必要的 DOM 元素
    doc._setElement('transitionMask', { style: { display: 'none' } });
    doc._setElement('transitionText', { textContent: '' });
    doc._setElement('adminDate', { textContent: '' });
    doc._setElement('adminModal', { classList: { add: () => {}, remove: () => {} }, addEventListener: () => {} });
    doc._setElement('toast', {
        textContent: '',
        classList: { add: () => {}, remove: () => {} },
    });
    doc._setElement('adminContent', { innerHTML: '' });

    const context = vm.createContext({
        // --- DOM mocks ---
        document: doc,
        navigator: { serviceWorker: { register: async () => ({ scope: '' }) } },
        window: { addEventListener: () => {} },
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        location: { href: '' },
        localStorage: { getItem: () => null, setItem: () => {} },

        // --- 项目依赖 ---
        ConnectionManager: {
            getMode: () => 'online',
            start: async () => {},
            ...(mocks.ConnectionManager || {}),
        },
        API: {
            getData: async () => ({}),
            migrateBountyCompletionsToTotal: () => {},
            ...mocks.API,
        },
        DB: {
            cacheFullData: async () => {},
            getFullData: async () => ({}),
        },
        CRDTLog: { append: () => {}, migrateFromChangeLog: async () => {} },

        // --- 全局变量（由 initAdmin / refreshAllData 初始化）---
        cachedData: null,
        adminHomeworks: [],
        adminBountyTasks: [],

        // --- JS runtime ---
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

    vm.runInContext(adminCode, context, { timeout: 5000 });
    return context;
}

// ========== 测试 ==========

describe('deleteAdminHw 删除作业', () => {
    let API;
    let ctx;

    beforeEach(() => {
        API = {
            getData: async () => ({}),
            migrateBountyCompletionsToTotal: () => {},
            deleteHomework: (() => {
                const fn = async (id) => { fn._lastId = id; return true; };
                fn._lastId = null;
                return fn;
            })(),
            putHomework: (() => {
                const fn = async (id) => { fn._lastId = id; return true; };
                fn._lastId = null;
                return fn;
            })(),
            putBountyTask: async (id) => true,
            deleteBountyTask: async (id) => true,
        };

        ctx = loadAdminInVM({ API });
    });

    // Feature: 管理端删除作业
    //   Scenario: 删除 pending 状态的作业
    //     Given 作业列表中有多个作业
    //     When 管理端删除其中一个作业
    //     Then 应调用 API.deleteHomework 仅删除指定作业
    //     And 不应调用 API.putHomework

    test('deleteAdminHw 应调用 API.deleteHomework 删除指定作业', async () => {
        // 准备作业数据
        ctx.adminHomeworks = [
            { id: 'hw1', subject: '数学', content: '练习册', status: 'pending' },
            { id: 'hw2', subject: '语文', content: '作文', status: 'pending' },
            { id: 'hw3', subject: '英语', content: '单词', status: 'pending' },
        ];

        // 执行删除
        await ctx.deleteAdminHw('hw2');

        // 应调用 deleteHomework 且传入正确的 id
        assert.strictEqual(
            API.deleteHomework._lastId,
            'hw2',
            'deleteAdminHw 应调用 API.deleteHomework 且传入正确的 id'
        );

        // 不应调用 putHomework
        assert.strictEqual(
            API.putHomework._lastId,
            null,
            'deleteAdminHw 不应调用 API.putHomework'
        );
    });
});

describe('deleteBountyTask 删除赏金任务', () => {
    let API;
    let ctx;

    beforeEach(() => {
        API = {
            getData: async () => ({}),
            migrateBountyCompletionsToTotal: () => {},
            deleteHomework: async (id) => true,
            putHomework: async (id) => true,
            putBountyTask: (() => {
                const fn = async (id) => { fn._lastId = id; return true; };
                fn._lastId = null;
                return fn;
            })(),
            deleteBountyTask: (() => {
                const fn = async (id) => { fn._lastId = id; return true; };
                fn._lastId = null;
                return fn;
            })(),
        };

        ctx = loadAdminInVM({ API });
    });

    // Feature: 管理端删除赏金任务
    //   Scenario: 删除一个赏金任务
    //     Given 赏金任务列表中有多个任务
    //     When 管理端删除其中一个任务
    //     Then 应调用 API.deleteBountyTask 仅删除指定任务
    //     And 不应调用 API.putBountyTask

    test('deleteBountyTask 应调用 API.deleteBountyTask 删除指定赏金任务', async () => {
        // 准备赏金任务数据
        ctx.adminBountyTasks = [
            { id: 'bt1', name: '洗碗', points: 10 },
            { id: 'bt2', name: '扫地', points: 5 },
        ];

        // 执行删除
        await ctx.deleteBountyTask('bt1');

        // 应调用 deleteBountyTask 且传入正确的 id
        assert.strictEqual(
            API.deleteBountyTask._lastId,
            'bt1',
            'deleteBountyTask 应调用 API.deleteBountyTask 且传入正确的 id'
        );

        // 不应调用 putBountyTask
        assert.strictEqual(
            API.putBountyTask._lastId,
            null,
            'deleteBountyTask 不应调用 API.putBountyTask'
        );
    });
});
