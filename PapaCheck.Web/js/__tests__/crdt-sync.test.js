/**
 * crdt-sync.test.js - CRDTLog 单元测试
 *
 * Feature: CRDTLog 操作日志模块
 */

import { describe, test, assert, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== 加载 crdt-sync.js ==========

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

function createCRDTLogContext() {
  const crdtCode = fs.readFileSync(
    path.join(__dirname, '..', 'crdt-sync.js'),
    'utf8'
  );

  const mockLocalForage = {
    createInstance: () => new MockStore(),
  };

  // 模拟 ChangeLog
  const mockChangeLog = {
    _entries: [],
    _nextId: 1,
    async add(type, uuid, data) {
      const entry = {
        id: this._nextId++,
        type,
        uuid,
        data,
        table_name: 'homeworks',
        record_key: uuid,
        timestamp: new Date().toISOString(),
      };
      this._entries.push(entry);
      return entry;
    },
    async getPending() {
      return [...this._entries];
    },
    async clear() {
      this._entries = [];
      this._nextId = 1;
    },
    async count() {
      return this._entries.length;
    },
  };

  const context = vm.createContext({
    localforage: mockLocalForage,
    ChangeLog: mockChangeLog,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
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

  vm.runInContext(crdtCode, context);
  return context.CRDTLog;
}

describe('CRDTLog 基本操作', () => {
  // Scenario: append 写入后能读取
  //   Given 一个新的 CRDTLog
  //   When 追加一条操作日志
  //   Then 日志写入成功，返回 id
  test('CRDTLog.append 写入后能读取', async () => {
    const CRDTLog = createCRDTLogContext();
    const id = await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-123',
      value: { status: 'done' },
    });
    assert.ok(id, 'should return a non-empty id');
    assert.typeOf(id, 'string');

    const pending = await CRDTLog.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].resourceId, 'hw-123');
    assert.equal(pending[0].type, 'update');
    assert.equal(pending[0].table, 'homeworks');
  });

  // Scenario: getPending 只返回未同步操作
  //   Given CRDTLog 中有两条记录，一条已同步一条未同步
  //   When 调用 getPending
  //   Then 只返回未同步的记录
  test('CRDTLog.getPending 返回未同步操作', async () => {
    const CRDTLog = createCRDTLogContext();

    const id1 = await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: { status: 'done' },
    });

    const id2 = await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-2',
      value: { status: 'pending' },
    });

    await CRDTLog.ack(id1);

    const pending = await CRDTLog.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].resourceId, 'hw-2');
  });

  // Scenario: ack 标记操作已同步
  //   Given CRDTLog 中有一条未同步记录
  //   When 调用 ack 标记已同步
  //   Then getPending 不再返回该记录
  test('CRDTLog.ack 标记已同步', async () => {
    const CRDTLog = createCRDTLogContext();

    const id = await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-123',
      value: { status: 'done' },
    });

    let pending = await CRDTLog.getPending();
    assert.equal(pending.length, 1);

    await CRDTLog.ack(id);

    pending = await CRDTLog.getPending();
    assert.equal(pending.length, 0);
  });

  // Scenario: getSince 返回 timestamp 之后的所有操作
  //   Given CRDTLog 中有两条不同时间的记录
  //   When 调用 getSince
  //   Then 只返回指定时间之后的记录
  test('CRDTLog.getSince 按时间筛选', async () => {
    const CRDTLog = createCRDTLogContext();

    await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: { status: 'done' },
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-2',
      value: { status: 'pending' },
      timestamp: '2025-06-01T00:00:00.000Z',
    });

    const result = await CRDTLog.getSince('2025-01-01T00:00:00.000Z');
    assert.equal(result.length, 1);
    assert.equal(result[0].resourceId, 'hw-2');
  });

  // Scenario: ackUpTo 标记 timestamp 之前的所有操作为已同步
  //   Given CRDTLog 中有三条不同时间的未同步记录
  //   When 调用 ackUpTo
  //   Then 指定时间之前的记录被标记为已同步
  test('CRDTLog.ackUpTo 批量标记已同步', async () => {
    const CRDTLog = createCRDTLogContext();

    await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: {},
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-2',
      value: {},
      timestamp: '2025-03-01T00:00:00.000Z',
    });

    await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-3',
      value: {},
      timestamp: '2025-06-01T00:00:00.000Z',
    });

    await CRDTLog.ackUpTo('2025-04-01T00:00:00.000Z');

    const pending = await CRDTLog.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].resourceId, 'hw-3');
  });

  // Scenario: cleanup 清除已同步的操作日志
  //   Given CRDTLog 中有已同步和未同步的记录
  //   When 调用 cleanup
  //   Then 仅清除已同步的记录
  test('CRDTLog.cleanup 清除已同步数据', async () => {
    const CRDTLog = createCRDTLogContext();

    const id1 = await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: {},
    });

    await CRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-2',
      value: {},
    });

    await CRDTLog.ack(id1);
    await CRDTLog.cleanup();

    const pending = await CRDTLog.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].resourceId, 'hw-2');
  });
});

describe('CRDTLog.migrateFromChangeLog', () => {
  // Scenario: 从 ChangeLog 迁移 pending 变更到 CRDTLog
  //   Given ChangeLog 中有两条记录
  //   When 调用 migrateFromChangeLog
  //   Then CRDTLog 中有对应的记录，且 ChangeLog 被清空
  test('将 ChangeLog 条目迁移到 CRDTLog', async () => {
    const CRDTLog = createCRDTLogContext();

    // 直接操作 context 中的 ChangeLog（通过 CRDTLog 内部引用）
    const context = createCRDTLogContext.getChangeLog
      ? createCRDTLogContext.getChangeLog()
      : null;

    // 使用全局 ChangeLog 引用 — 因为 crdt-sync.js 通过 ChangeLog 全局变量引用
    // 在 createCRDTLogContext 中已设置了 mockChangeLog
    // 这里需要重新构建一个带初始数据的 scenario
    const crdtCode = fs.readFileSync(
      path.join(__dirname, '..', 'crdt-sync.js'),
      'utf8'
    );

    const mockStore = new MockStore();

    const mockLocalForage = {
      createInstance: () => mockStore,
    };

    const mockChangeLogWithData = {
      _entries: [
        { id: 1, type: 'update', uuid: 'hw-1', data: { status: 'done' }, table_name: 'homeworks', record_key: 'hw-1', timestamp: '2025-01-01T00:00:00.000Z' },
        { id: 2, type: 'update', uuid: 'hw-2', data: { status: 'pending' }, table_name: 'homeworks', record_key: 'hw-2', timestamp: '2025-01-02T00:00:00.000Z' },
      ],
      _nextId: 3,
      async getPending() { return [...this._entries]; },
      async clear() {
        this._entries = [];
        this._nextId = 1;
      },
    };

    const context2 = vm.createContext({
      localforage: mockLocalForage,
      ChangeLog: mockChangeLogWithData,
      console: { log: () => {}, warn: () => {}, error: () => {} },
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

    vm.runInContext(crdtCode, context2);
    const CRDTLog2 = context2.CRDTLog;

    await CRDTLog2.migrateFromChangeLog();

    // ChangeLog 应该已被清空
    assert.equal(mockChangeLogWithData._entries.length, 0);

    // CRDTLog 应该有 2 条记录
    const pending = await CRDTLog2.getPending();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].resourceId, 'hw-1');
    assert.equal(pending[1].resourceId, 'hw-2');
  });

  // Scenario: ChangeLog 为空时迁移不报错
  //   Given ChangeLog 为空
  //   When 调用 migrateFromChangeLog
  //   Then 不抛出异常，CRDTLog 为空
  test('空 ChangeLog 迁移不报错', async () => {
    const crdtCode = fs.readFileSync(
      path.join(__dirname, '..', 'crdt-sync.js'),
      'utf8'
    );

    const mockLocalForage = { createInstance: () => new MockStore() };

    const emptyChangeLog = {
      _entries: [],
      async getPending() { return []; },
      async clear() { this._entries = []; },
    };

    const context = vm.createContext({
      localforage: mockLocalForage,
      ChangeLog: emptyChangeLog,
      console: { log: () => {}, warn: () => {}, error: () => {} },
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

    vm.runInContext(crdtCode, context);
    const CRDTLog = context.CRDTLog;

    // 应该不会抛出异常
    await CRDTLog.migrateFromChangeLog();

    const pending = await CRDTLog.getPending();
    assert.equal(pending.length, 0);
  });

  // Scenario: ChangeLog 未定义时迁移不报错
  //   Given ChangeLog 未定义
  //   When 调用 migrateFromChangeLog
  //   Then 不抛出异常，静默跳过
  test('ChangeLog 未定义时迁移不报错', async () => {
    const crdtCode = fs.readFileSync(
      path.join(__dirname, '..', 'crdt-sync.js'),
      'utf8'
    );

    const mockLocalForage = { createInstance: () => new MockStore() };

    // 不设置 ChangeLog — 模拟生产环境中 ChangeLog 可能不存在（如 admin 页面）
    const context = vm.createContext({
      localforage: mockLocalForage,
      console: { log: () => {}, warn: () => {}, error: () => {} },
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

    vm.runInContext(crdtCode, context);
    const CRDTLog = context.CRDTLog;

    // 应该不会抛出异常
    await CRDTLog.migrateFromChangeLog();
  });
});
