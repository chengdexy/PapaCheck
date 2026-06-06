/**
 * test_change_log_clear_up_to.js - ChangeLog.clearUpTo 单元测试
 *
 * Feature: ChangeLog.clearUpTo(maxId)
 *   解决 fullSync() 中全量 clear() 导致推送期间新增条目丢失的竞态条件。
 *
 *   Scenario: 清除 ID <= maxId 的条目，保留 ID > maxId 的条目
 *     Given ChangeLog 中有 id=1, id=2, id=3 三条变更
 *     When  调用 clearUpTo(2)
 *     Then  条目 1 和 2 被清除
 *     And   条目 3 保留
 *
 *   Scenario: maxId 小于所有条目的 ID 时不清除任何条目
 *     Given ChangeLog 中有 id=5, id=6 两条变更
 *     When  调用 clearUpTo(4)
 *     Then  条目 5 和 6 都保留
 *
 *   Scenario: maxId 大于所有条目的 ID 时清除所有条目
 *     Given ChangeLog 中有 id=1, id=2 两条变更
 *     When  调用 clearUpTo(10)
 *     Then  条目 1 和 2 都被清除
 *
 *   Scenario: 空 ChangeLog 调用 clearUpTo 不报错
 *     Given ChangeLog 为空
 *     When  调用 clearUpTo(5)
 *     Then  不抛出异常，ChangeLog 仍然为空
 *
 *   Scenario: clearUpTo 不清除 _nextId
 *     Given ChangeLog 中有 id=1 的条目，_nextId=2
 *     When  调用 clearUpTo(1)
 *     Then  条目 1 被清除
 *     And   _nextId 仍为 2
 *     And   再次 add 新条目时 id 为 2
 */

import { describe, test, assert, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== 加载 change-log.js ==========

function createTestContext() {
    const changeLogCode = fs.readFileSync(
        path.join(__dirname, '..', 'PapaCheck.Web', 'js', 'change-log.js'),
        'utf8'
    );

    // localforage mock — 使用内存 Map 模拟
    class MockStore {
        constructor() {
            this._data = new Map();
        }
        async getItem(key) {
            return this._data.get(key) ?? null;
        }
        async setItem(key, value) {
            this._data.set(key, value);
        }
        async removeItem(key) {
            this._data.delete(key);
        }
        async clear() {
            this._data.clear();
        }
        async iterate(callback) {
            for (const [key, value] of this._data.entries()) {
                callback(value, key);
            }
        }
    }

    const mockLocalForage = {
        createInstance: () => new MockStore(),
    };

    const context = vm.createContext({
        localforage: mockLocalForage,
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
        Number,
        String,
        Boolean,
    });

    // Wrap code to expose `var` declarations
    const wrappedCode = 'var localforage = localforage;\n' + changeLogCode;
    vm.runInContext(wrappedCode, context);
    return context;
}

async function setupChangeLog(context, entries) {
    const ChangeLog = context.ChangeLog;
    for (const e of entries) {
        await ChangeLog.add(e.type, e.uuid, e.data);
    }
    return ChangeLog;
}

describe('ChangeLog.clearUpTo', () => {
    // Scenario: 清除 ID <= maxId 的条目，保留 ID > maxId 的条目
    //   Given ChangeLog 中有 id=1, id=2, id=3 三条变更
    //   When  调用 clearUpTo(2)
    //   Then  条目 1 和 2 被清除，条目 3 保留
    test('清除 ID <= maxId 的条目，保留 ID > maxId 的条目', async () => {
        const ctx = createTestContext();
        const ChangeLog = await setupChangeLog(ctx, [
            { type: 'update', uuid: 'a', data: { name: 'task1' } },
            { type: 'update', uuid: 'b', data: { name: 'task2' } },
            { type: 'update', uuid: 'c', data: { name: 'task3' } },
        ]);

        assert.equal(await ChangeLog.count(), 3);

        await ChangeLog.clearUpTo(2);

        const remaining = await ChangeLog.getPending();
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].uuid, 'c');
    });

    // Scenario: maxId 小于所有条目的 ID 时不清除任何条目
    //   Given ChangeLog 中有 id=1, id=2 两条变更（均大于 maxId=0）
    //   When  调用 clearUpTo(0)
    //   Then  条目 1 和 2 都保留
    test('maxId 小于所有条目 ID 时不清除任何条目', async () => {
        const ctx = createTestContext();
        const ChangeLog = await setupChangeLog(ctx, [
            { type: 'update', uuid: 'x', data: { name: 'old1' } },
            { type: 'update', uuid: 'y', data: { name: 'old2' } },
        ]);

        await ChangeLog.clear();
        await ChangeLog.add('update', 'x', { name: 'old1' }); // id=1
        await ChangeLog.add('update', 'y', { name: 'old2' }); // id=2

        assert.equal(await ChangeLog.count(), 2);

        // maxId=0 < 1,2 → clearUpTo 不应清除任何条目
        await ChangeLog.clearUpTo(0);

        assert.equal(await ChangeLog.count(), 2);
    });

    // Scenario: maxId 大于所有条目的 ID 时清除所有条目
    //   Given ChangeLog 中有 id=1, id=2 两条变更
    //   When  调用 clearUpTo(10)
    //   Then  条目 1 和 2 都被清除
    test('maxId 大于所有条目 ID 时清除所有条目', async () => {
        const ctx = createTestContext();
        const ChangeLog = await setupChangeLog(ctx, [
            { type: 'update', uuid: 'a', data: { name: 't1' } },
            { type: 'update', uuid: 'b', data: { name: 't2' } },
        ]);

        assert.equal(await ChangeLog.count(), 2);

        await ChangeLog.clearUpTo(10);

        assert.equal(await ChangeLog.count(), 0);
    });

    // Scenario: 空 ChangeLog 调用 clearUpTo 不报错
    //   Given ChangeLog 为空
    //   When  调用 clearUpTo(5)
    //   Then  不抛出异常，ChangeLog 仍然为空
    test('空 ChangeLog 调用 clearUpTo 不报错', async () => {
        const ctx = createTestContext();
        const ChangeLog = ctx.ChangeLog;

        assert.equal(await ChangeLog.count(), 0);

        await ChangeLog.clearUpTo(5);

        assert.equal(await ChangeLog.count(), 0);
    });

    // Scenario: clearUpTo 不清除 _nextId
    //   Given ChangeLog 中有 id=1 的条目，_nextId=2
    //   When  调用 clearUpTo(1)
    //   Then  条目 1 被清除
    //   And   _nextId 仍为 2
    //   And   再次 add 新条目时 id 为 2
    test('clearUpTo 不清除 _nextId，后续 add 使用正确的递增 ID', async () => {
        const ctx = createTestContext();
        const ChangeLog = await setupChangeLog(ctx, [
            { type: 'update', uuid: 'a', data: { name: 't1' } },
        ]);

        assert.equal(await ChangeLog.count(), 1);

        await ChangeLog.clearUpTo(1);

        assert.equal(await ChangeLog.count(), 0);

        // 新增一个条目，验证 ID 是从 2 开始
        await ChangeLog.add('update', 'new', { name: 'newTask' });
        const pending = await ChangeLog.getPending();
        assert.equal(pending.length, 1);
        assert.equal(pending[0].id, 2);
        assert.equal(pending[0].uuid, 'new');
    });
});
