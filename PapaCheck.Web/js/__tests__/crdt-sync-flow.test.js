/**
 * crdt-sync-flow.test.js - CRDT 同步流程集成测试
 *
 * Feature: CRDT 同步流程
 *   Scenario: crdtPush 推送操作日志
 *     Given 有待同步的操作日志
 *     When 推送操作日志
 *     Then 操作日志标记为已同步
 *
 *   Scenario: crdtPull 拉取远程操作
 *     Given 服务端有新操作
 *     When 拉取远程操作
 *     Then 本地数据更新
 *
 * 使用 vm 沙箱加载实际代码进行测试
 */

import { describe, test, assert, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== 公共 Mock 实现 ==========

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

class MockFetch {
  constructor() {
    this._queue = [];
  }

  /** 添加一个 mock 响应，按添加顺序消费 */
  add(matcher, response) {
    this._queue.push({ matcher, response });
  }

  /** 添加一个默认 ok 响应用于兜底 */
  setDefault(response) {
    this._default = response;
  }

  async fetch(url, options) {
    for (let i = 0; i < this._queue.length; i++) {
      const entry = this._queue[i];
      if (entry.matcher(url, options)) {
        this._queue.splice(i, 1);
        return entry.response;
      }
    }
    if (this._default) {
      return typeof this._default === 'function' ? this._default(url, options) : this._default;
    }
    return { ok: true, async json() { return {}; } };
  }
}

function okJson(data) {
  return {
    ok: true,
    async json() { return data; },
  };
}

function createSyncEngineContext() {
  const syncCode = fs.readFileSync(
    path.join(__dirname, '..', 'sync.js'),
    'utf8'
  );

  const mockStore = new MockStore();
  const mockLocalForage = {
    createInstance: () => mockStore,
  };

  // Mock ChangeLog
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
    async getPending() { return [...this._entries]; },
    async clearUpTo(id) {
      this._entries = this._entries.filter(e => e.id > id);
    },
  };

  // Mock CRDTLog
  const mockCRDTLog = {
    _entries: new Map(),
    _nextId: 1,
    async append(op) {
      const id = 'test-op-' + (this._nextId++);
      const entry = { ...op, id, synced: false,
        timestamp: op.timestamp || new Date().toISOString(),
        nodeId: op.nodeId || 'test-node',
      };
      this._entries.set(id, entry);
      return id;
    },
    async getPending() {
      const pending = [];
      for (const entry of this._entries.values()) {
        if (!entry.synced) pending.push(entry);
      }
      return pending.sort((a, b) => a.timestamp > b.timestamp ? 1 : -1);
    },
    async ack(id) {
      const entry = this._entries.get(id);
      if (entry) entry.synced = true;
    },
    async cleanup() {
      for (const [key, value] of this._entries.entries()) {
        if (value.synced) this._entries.delete(key);
      }
    },
  };

  // Mock DB
  const mockDB = {
    _data: {},
    async getFullData() { return this._data; },
    async cacheFullData(data) { this._data = data; },
  };

  // Mock fetch
  const mockFetch = new MockFetch();

  const context = vm.createContext({
    localforage: mockLocalForage,
    ChangeLog: mockChangeLog,
    CRDTLog: mockCRDTLog,
    DB: mockDB,
    fetch: mockFetch.fetch.bind(mockFetch),
    window: {
      _serverBaseUrl: '',
      location: { origin: 'http://localhost:3000' },
    },
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
    encodeURIComponent,
  });

  vm.runInContext(syncCode, context);

  return {
    SyncEngine: context.SyncEngine,
    mockChangeLog,
    mockCRDTLog,
    mockDB,
    mockFetch,
    mockStore,
    context,
  };
}

// ========== 测试套件 ==========

describe('CRDT 同步流程', () => {

  // Scenario: crdtPush 无待同步操作时返回 true
  //   Given 没有待同步的操作日志
  //   When 调用 crdtPush
  //   Then 直接返回 true
  test('crdtPush 无待同步操作直接返回 true', async () => {
    const { SyncEngine, mockCRDTLog } = createSyncEngineContext();

    assert.equal((await mockCRDTLog.getPending()).length, 0);
    const result = await SyncEngine.crdtPush();
    assert.equal(result, true);
  });

  // Scenario: crdtPush 推送操作日志
  //   Given 有待同步的操作日志
  //   When 推送操作日志到服务端
  //   Then 操作日志被标记为已同步
  test('crdtPush 推送操作日志并标记已同步', async () => {
    const { SyncEngine, mockCRDTLog, mockFetch } = createSyncEngineContext();

    // Given: 有待同步的操作日志
    await mockCRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: { status: 'done' },
      timestamp: new Date().toISOString(),
    });
    await mockCRDTLog.append({
      type: 'update',
      table: 'points',
      resourceId: 'points',
      value: { balance: 50 },
      timestamp: new Date().toISOString(),
    });
    assert.equal((await mockCRDTLog.getPending()).length, 2);

    // Mock crdt-push 端点
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      okJson({ ok: true })
    );

    // When: 推送操作日志
    const result = await SyncEngine.crdtPush();

    // Then: 返回 true
    assert.equal(result, true);
    // Then: 所有操作日志标记为已同步
    assert.equal((await mockCRDTLog.getPending()).length, 0);
  });

  // Scenario: crdtPull 拉取远程操作（无远程变更）
  //   Given 服务端无新操作
  //   When 拉取远程操作
  //   Then 返回 true，本地数据刷新
  test('crdtPull 无远程变更时返回 true', async () => {
    const { SyncEngine, mockFetch } = createSyncEngineContext();

    // Given: crdt-pull 返回空操作列表
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({ operations: [] })
    );

    // _refreshFromServer 的 /api/data 端点
    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({ points: { balance: 100 } })
    );

    // When: 拉取远程操作
    const result = await SyncEngine.crdtPull();

    // Then: 返回 true
    assert.equal(result, true);
  });

  // Scenario: crdtPull 拉取远程操作（有远程变更）
  //   Given 服务端有新操作
  //   When 拉取远程操作
  //   Then 返回 true，本地数据通过全量刷新更新
  test('crdtPull 有远程变更时返回 true', async () => {
    const { SyncEngine, mockFetch } = createSyncEngineContext();

    // Given: crdt-pull 返回有操作，且 /api/data 返回新数据
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({
        operations: [
          { id: 'op-remote-1', type: 'update', table: 'homeworks', resourceId: 'hw-99', value: { status: 'new' } },
        ],
      })
    );

    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({ homeworks: { '2025-01-01': [{ id: 'hw-99', status: 'new' }] } })
    );

    // When: 拉取远程操作
    const result = await SyncEngine.crdtPull();

    // Then: 返回 true
    assert.equal(result, true);
  });

  // Scenario: crdtFullSync 全量 CRDT 同步
  //   Given 有待同步的操作日志且服务端有数据
  //   When 执行全量 CRDT 同步
  //   Then 推送成功，拉取成功，更新同步时间
  test('crdtFullSync 执行全量 CRDT 同步', async () => {
    const { SyncEngine, mockCRDTLog, mockFetch } = createSyncEngineContext();

    // Given: 有待同步的操作日志
    await mockCRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: { status: 'done' },
      timestamp: new Date().toISOString(),
    });
    assert.equal((await mockCRDTLog.getPending()).length, 1);

    // Mock crdt-push 端点
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      okJson({ ok: true })
    );

    // Mock crdt-pull 端点
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({ operations: [] })
    );

    // Mock /api/data 端点
    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({ points: { balance: 100 } })
    );

    // When: 执行全量 CRDT 同步
    const result = await SyncEngine.crdtFullSync();

    // Then: 同步成功
    assert.equal(result, true);
    // Then: 操作日志已清理
    assert.equal((await mockCRDTLog.getPending()).length, 0);
    // Then: 同步时间已更新
    const lastSync = await SyncEngine.getLastSyncTime();
    assert.ok(lastSync, '同步时间应已更新');
  });

  // Scenario: crdtFullSync 同步中不重复执行
  //   Given 正在执行同步
  //   When 重复调用 crdtFullSync
  //   Then 返回 false
  test('crdtFullSync 同步中不重复执行', async () => {
    const { SyncEngine, mockFetch } = createSyncEngineContext();

    // Mock 所有端点（让同步过程可以完成）
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      okJson({ ok: true })
    );
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({ operations: [] })
    );
    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({})
    );

    // 第一次同步启动后，第二次应返回 false
    const promise1 = SyncEngine.crdtFullSync();
    const result2 = await SyncEngine.crdtFullSync();
    assert.equal(result2, false);

    await promise1;
  });

  // Scenario: crdtPush 服务端错误时抛出异常
  //   Given 有待同步的操作日志
  //   When crdt-push 服务端返回错误
  //   Then 抛出异常
  test('crdtPush 服务端错误时抛出异常', async () => {
    const { SyncEngine, mockCRDTLog, mockFetch } = createSyncEngineContext();

    // Given: 有待同步的操作日志
    await mockCRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: {},
    });

    // Mock 服务端返回错误
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      { ok: false, status: 500 }
    );

    // When / Then: 抛出异常
    try {
      await SyncEngine.crdtPush();
      assert.fail('应该抛出异常');
    } catch (e) {
      assert.ok(e.message.includes('CRDT push failed'), '异常消息应包含 CRDT push failed');
    }
  });

  // Scenario: crdtFullSync 推送失败时整个同步失败
  //   Given 有待同步的操作日志，服务端返回 500
  //   When crdtPush 抛出异常
  //   Then crdtFullSync 返回 false
  test('crdtFullSync 推送失败时返回 false', async () => {
    const { SyncEngine, mockCRDTLog, mockFetch } = createSyncEngineContext();

    // Given: 有待同步的操作日志
    await mockCRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: {},
    });

    // Mock crdt-push 端点返回 HTTP 500，导致 crdtPush 抛出异常
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      { ok: false, status: 500 }
    );

    // When: 执行全量 CRDT 同步
    const result = await SyncEngine.crdtFullSync();

    // Then: crdtPush 抛出异常，crdtFullSync 返回 false
    assert.equal(result, false);
  });
});
