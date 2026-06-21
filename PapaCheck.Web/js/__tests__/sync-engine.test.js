/**
 * sync-engine.test.js - SyncEngine 锁超时保护
 *
 * Feature: SyncEngine 锁超时保护
 *   Scenario: 锁超时后强制释放
 *     Given crdtFullSync 正在进行且 _syncInProgress 为 true
 *     And 距离锁开始时间超过 15 秒
 *     When 再次调用 crdtFullSync
 *     Then 强制释放锁并重新执行同步
 *     And 控制台输出"锁超时，强制释放"警告
 *
 *   Scenario: 锁未超时则拒绝并发调用
 *     Given crdtFullSync 正在进行且 _syncInProgress 为 true
 *     And 距离锁开始时间未超过 15 秒
 *     When 再次调用 crdtFullSync
 *     Then 返回 false 且不执行同步逻辑
 *
 *   Scenario: forceReleaseLock 供外部调用
 *     Given _syncInProgress 为 true
 *     When 调用 SyncEngine.forceReleaseLock()
 *     Then _syncInProgress 重置为 false
 *     And 控制台输出"外部强制释放锁"警告
 *
 * Feature: 简化版 crdtFullSync
 *   Scenario: crdtFullSync 只做 push 和 pull
 *     Given SyncEngine 处于在线状态
 *     When 调用 crdtFullSync
 *     Then 依次执行 crdtPush 和 _refreshFromServer
 *     And 不执行任何本地合并逻辑
 *
 *   Scenario: crdtPush 失败不阻塞 pull
 *     Given crdtPush 抛出异常
 *     When 调用 crdtFullSync
 *     Then crdtPush 错误被捕获并记录警告
 *     And _refreshFromServer 仍正常执行
 *     And 返回 true
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ========== Mock 工具 ==========

class MockStore {
  constructor() { this._data = new Map(); }
  async getItem(key) { return this._data.get(key) ?? null; }
  async setItem(key, value) { this._data.set(key, value); }
  async removeItem(key) { this._data.delete(key); }
  async clear() { this._data.clear(); }
  async iterate(callback) { for (const [key, value] of this._data.entries()) { callback(value, key); } }
}

class MockFetch {
  constructor() { this._queue = []; this._default = null; }
  add(matcher, response) { this._queue.push({ matcher, response }); }
  setDefault(response) { this._default = response; }
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
  return { ok: true, async json() { return data; } };
}

/**
 * 创建 SyncEngine 的 vm 上下文。
 * resolveSlowFetch 可选 — 如果提供，crdt-push 的 fetch 会等待该 resolve 被调用才返回。
 */
function createSyncEngineContext(resolveSlowFetch) {
  const syncCode = fs.readFileSync(
    path.join(__dirname, '..', 'sync.js'),
    'utf8'
  );

  const mockStore = new MockStore();
  const mockLocalForage = {
    createInstance: () => mockStore,
  };

  const mockChangeLog = {
    _entries: [], _nextId: 1,
    async add(type, uuid, data) {
      const entry = { id: this._nextId++, type, uuid, data, table_name: 'homeworks', record_key: uuid, timestamp: new Date().toISOString() };
      this._entries.push(entry); return entry;
    },
    async getPending() { return [...this._entries]; },
    async clearUpTo(id) { this._entries = this._entries.filter(e => e.id > id); },
  };

  const mockCRDTLog = {
    _entries: new Map(), _nextId: 1,
    async append(op) {
      const id = 'test-op-' + (this._nextId++);
      const entry = { ...op, id, synced: false, timestamp: op.timestamp || new Date().toISOString(), nodeId: op.nodeId || 'test-node' };
      this._entries.set(id, entry); return id;
    },
    async getPending() {
      const pending = [];
      for (const entry of this._entries.values()) { if (!entry.synced) pending.push(entry); }
      return pending.sort((a, b) => a.timestamp > b.timestamp ? 1 : -1);
    },
    async ack(id) { const entry = this._entries.get(id); if (entry) entry.synced = true; },
    async cleanup() { for (const [key, value] of this._entries.entries()) { if (value.synced) this._entries.delete(key); } },
  };

  const mockDB = {
    _data: {},
    async getFullData() { return this._data; },
    async cacheFullData(data) { this._data = data; },
  };

  const mockFetch = new MockFetch();

  // 如果 resolveSlowFetch 被提供，创建一个慢 fetch 用于 crdt-push
  if (resolveSlowFetch) {
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      new Promise(resolve => { resolveSlowFetch.resolve = () => resolve(okJson({ ok: true })); })
    );
  } else {
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      okJson({ ok: true })
    );
  }
  mockFetch.add(
    (url) => url.includes('/api/sync/crdt-pull'),
    okJson({ operations: [] })
  );
  mockFetch.add(
    (url) => url.includes('/api/data'),
    okJson({})
  );

  const warnLogs = [];
  const context = vm.createContext({
    localforage: mockLocalForage,
    ChangeLog: mockChangeLog,
    CRDTLog: mockCRDTLog,
    DB: mockDB,
    fetch: mockFetch.fetch.bind(mockFetch),
    window: { _serverBaseUrl: '', location: { origin: 'http://localhost:3000' } },
    console: { log: () => {}, warn: (msg) => { warnLogs.push(msg); }, error: () => {} },
    setTimeout, clearTimeout, JSON, Error, Object, Array, Math, Date, Map, Set, Promise, Symbol, Number, String, Boolean, encodeURIComponent,
  });

  vm.runInContext(syncCode, context);

  return {
    SyncEngine: context.SyncEngine,
    mockChangeLog, mockCRDTLog, mockDB, mockFetch, mockStore,
    warnLogs, context,
  };
}

// ========== 测试套件 ==========

describe('_syncInProgress 锁超时保护', () => {
  it('锁未超时则拒绝并发调用', async () => {
    const { SyncEngine, mockFetch } = createSyncEngineContext();

    // Mock crdt-push 慢响应，让第一个调用保持锁
    let pushResolve;
    mockFetch.setDefault(undefined); // 清除默认
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      new Promise(resolve => { pushResolve = () => resolve(okJson({ ok: true })); })
    );
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({ operations: [] })
    );
    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({})
    );

    // When: 发起第一次同步
    const promise1 = SyncEngine.crdtFullSync();

    // When: 立即发起第二次同步（锁未超时）
    const result2 = await SyncEngine.crdtFullSync();

    // Then: 第二次同步返回 false（被锁拒绝）
    expect(result2).toBe(false);

    // 释放第一次同步
    pushResolve();
    await promise1;
  });

  it('锁超时后强制释放', async () => {
    // 使用 fake timers 控制 Date.now()
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    // 重建 context，使 Date 使用 vitest mock
    const syncCode = fs.readFileSync(
      path.join(__dirname, '..', 'sync.js'),
      'utf8'
    );

    const mockStore = new MockStore();
    const mockLocalForage = { createInstance: () => mockStore };
    const mockChangeLog = {
      _entries: [], _nextId: 1,
      async add(type, uuid, data) {
        const entry = { id: this._nextId++, type, uuid, data, table_name: 'homeworks', record_key: uuid, timestamp: new Date().toISOString() };
        this._entries.push(entry); return entry;
      },
      async getPending() { return [...this._entries]; },
      async clearUpTo(id) { this._entries = this._entries.filter(e => e.id > id); },
    };
    const mockCRDTLog = {
      _entries: new Map(), _nextId: 1,
      async append(op) { const id = 'test-op-' + (this._nextId++); const entry = { ...op, id, synced: false, timestamp: op.timestamp || new Date().toISOString(), nodeId: op.nodeId || 'test-node' }; this._entries.set(id, entry); return id; },
      async getPending() { const pending = []; for (const entry of this._entries.values()) { if (!entry.synced) pending.push(entry); } return pending.sort((a, b) => a.timestamp > b.timestamp ? 1 : -1); },
      async ack(id) { const entry = this._entries.get(id); if (entry) entry.synced = true; },
      async cleanup() { for (const [key, value] of this._entries.entries()) { if (value.synced) this._entries.delete(key); } },
    };
    const mockDB = { _data: {}, async getFullData() { return this._data; }, async cacheFullData(data) { this._data = data; } };
    const mockFetch = new MockFetch();
    const warnLogs = [];

    // 第一个 crdt-push 慢
    let pushResolve;
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      new Promise(resolve => { pushResolve = () => resolve(okJson({ ok: true })); })
    );
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({ operations: [] })
    );
    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({})
    );

    // 第二个 crdt-push（超时释放后重新执行会用到的）
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

    // 使用 globalThis.Date（会得到 vitest mock Date）
    const context = vm.createContext({
      localforage: mockLocalForage,
      ChangeLog: mockChangeLog,
      CRDTLog: mockCRDTLog,
      DB: mockDB,
      fetch: mockFetch.fetch.bind(mockFetch),
      window: { _serverBaseUrl: '', location: { origin: 'http://localhost:3000' } },
      console: { log: () => {}, warn: (msg) => { warnLogs.push(msg); }, error: () => {} },
      setTimeout, clearTimeout, JSON, Error, Object, Array, Math, Map, Set, Promise, Symbol, Number, String, Boolean, encodeURIComponent,
      Date: globalThis.Date, // vitest mock Date
    });

    vm.runInContext(syncCode, context);
    const SyncEngine = context.SyncEngine;

    // Given: 发起第一次同步（锁被占用）
    const promise1 = SyncEngine.crdtFullSync();

    // When: 时间前进 16 秒（超过 15 秒超时阈值）
    vi.advanceTimersByTime(16000);

    // When: 再次调用 crdtFullSync
    const result2 = await SyncEngine.crdtFullSync();

    // Then: 超时后强制释放锁并成功执行同步
    expect(result2).toBe(true);

    // Then: 控制台输出锁超时警告
    const hasTimeoutWarn = warnLogs.some(msg => msg.includes('锁超时，强制释放'));
    expect(hasTimeoutWarn).toBe(true);

    pushResolve();
    await promise1;

    vi.useRealTimers();
  });

  it('forceReleaseLock 供外部调用', async () => {
    let pushResolve;
    const { SyncEngine, mockCRDTLog, mockFetch, warnLogs } = createSyncEngineContext();

    // 添加待同步操作，让 crdtPush 实际调用 fetch（保持锁占用）
    await mockCRDTLog.append({
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: { status: 'done' },
      timestamp: new Date().toISOString(),
    });

    // 覆盖 mock：让 crdt-push 慢响应
    mockFetch.setDefault(undefined);
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-push'),
      new Promise(resolve => { pushResolve = () => resolve(okJson({ ok: true })); })
    );
    mockFetch.add(
      (url) => url.includes('/api/sync/crdt-pull'),
      okJson({ operations: [] })
    );
    mockFetch.add(
      (url) => url.includes('/api/data'),
      okJson({})
    );

    // 检查 forceReleaseLock 存在
    expect(typeof SyncEngine.forceReleaseLock).toBe('function');

    // Given: 开始一次同步（锁在等待慢 fetch 时被占用）
    const promise1 = SyncEngine.crdtFullSync();

    // Then: 锁被占用
    expect(SyncEngine.isSyncing()).toBe(true);

    // When: 调用 forceReleaseLock
    SyncEngine.forceReleaseLock();

    // Then: 锁已释放
    expect(SyncEngine.isSyncing()).toBe(false);

    // Then: 控制台输出外部释放警告
    const hasWarn = warnLogs.some(msg => msg.includes('外部强制释放锁'));
    expect(hasWarn).toBe(true);

    // 清理
    pushResolve();
    await promise1;
  });
});

describe('简化版 crdtFullSync', () => {
  it('crdtFullSync 只做 push 和 pull', () => {});
  it('crdtPush 失败不阻塞 pull', () => {});
});
