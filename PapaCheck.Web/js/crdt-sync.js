/**
 * crdt-sync.js - CRDT 操作日志模块
 * 记录前端 PUT/PATCH/DELETE 操作，用于增量同步
 * 依赖: localforage (CDN, 在 index.html 中先于本文件加载)
 */
var CRDTLog = (function () {
  var _storeName = 'papacheck_crdt_log';
  var _store = null;

  // 初始化 localforage store
  async function _getStore() {
    if (!_store) {
      _store = localforage.createInstance({ name: _storeName });
    }
    return _store;
  }

  // 生成唯一操作 ID
  function _genOpId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  return {
    // 追加一条操作日志
    async append(op) {
      var store = await _getStore();
      var id = _genOpId();
      var entry = {
        id: id,
        type: op.type,        // 'add' | 'update' | 'delete'
        table: op.table,      // homeworks, points, ...
        resourceId: op.resourceId,
        field: op.field || null,
        value: op.value,
        timestamp: op.timestamp || new Date().toISOString(),
        nodeId: op.nodeId || 'web-' + Math.random().toString(36).substr(2, 5),
        synced: false,
      };
      await store.setItem(id, entry);
      return id;
    },

    // 获取所有待同步操作（synced === false）
    async getPending() {
      var store = await _getStore();
      var pending = [];
      await store.iterate(function (value, key) {
        if (!value.synced) {
          pending.push(value);
        }
      });
      return pending.sort(function (a, b) { return a.timestamp > b.timestamp ? 1 : -1; });
    },

    // 标记指定 id 的操作已同步
    async ack(id) {
      var store = await _getStore();
      var entry = await store.getItem(id);
      if (entry) {
        entry.synced = true;
        await store.setItem(id, entry);
      }
    },

    // 标记指定 timestamp 之前的所有操作为已同步
    async ackUpTo(timestamp) {
      var store = await _getStore();
      await store.iterate(function (value, key) {
        if (!value.synced && value.timestamp <= timestamp) {
          value.synced = true;
          store.setItem(key, value);
        }
      });
    },

    // 获取 timestamp 之后的所有操作（含已同步和未同步）
    async getSince(timestamp) {
      var store = await _getStore();
      var result = [];
      await store.iterate(function (value, key) {
        if (value.timestamp > timestamp) {
          result.push(value);
        }
      });
      return result.sort(function (a, b) { return a.timestamp > b.timestamp ? 1 : -1; });
    },

    // 从旧的 ChangeLog 迁移 pending 变更
    async migrateFromChangeLog() {
      if (typeof ChangeLog === 'undefined' || !ChangeLog.getPending) return;
      try {
        var pending = await ChangeLog.getPending();
        if (!pending || pending.length === 0) return;
        for (var i = 0; i < pending.length; i++) {
          var change = pending[i];
          // 将旧 ChangeLog 条目转为 CRDT 操作
          await this.append({
            type: 'update',
            table: change.table_name || 'unknown',
            resourceId: change.record_key || change.uuid || 'unknown',
            field: null,
            value: change.data,
            timestamp: change.timestamp || new Date().toISOString(),
          });
        }
        // 清空旧 ChangeLog
        if (typeof ChangeLog.clear === 'function') {
          await ChangeLog.clear();
        }
      } catch (e) {
        console.warn('ChangeLog 迁移失败（非致命）:', e);
      }
    },

    // 清除已同步的操作日志（数据清理）
    async cleanup() {
      var store = await _getStore();
      var toRemove = [];
      await store.iterate(function (value, key) {
        if (value.synced) {
          toRemove.push(key);
        }
      });
      for (var i = 0; i < toRemove.length; i++) {
        await store.removeItem(toRemove[i]);
      }
    },
  };
})();
