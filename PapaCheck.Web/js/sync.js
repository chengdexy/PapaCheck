/**
 * sync.js - 同步引擎
 * 负责检测服务端在线状态，上传本地变更，拉取远程变更，LWW 冲突解决
 */
var SyncEngine = (function() {
  var _syncInProgress = false;
  var _syncStartedAt = 0;
  var _SYNC_LOCK_TIMEOUT = 15000;
  var _lastSyncTime = null;
  var _baseUrl = '';

  function _getBaseUrl() {
    if (_baseUrl) return _baseUrl;
    if (window._serverBaseUrl) {
      _baseUrl = window._serverBaseUrl;
    } else {
      _baseUrl = window.location.origin;
    }
    return _baseUrl;
  }

  async function getLastSyncTime() {
    if (!_lastSyncTime) {
      try {
        var store = localforage.createInstance({ name: 'papacheck_sync' });
        _lastSyncTime = await store.getItem('lastSyncTime');
      } catch (e) {
        _lastSyncTime = null;
      }
    }
    return _lastSyncTime;
  }

  async function _saveLastSyncTime(time) {
    _lastSyncTime = time;
    try {
      var store = localforage.createInstance({ name: 'papacheck_sync' });
      await store.setItem('lastSyncTime', time);
    } catch (e) {
      // non-critical
    }
  }

  function isSyncing() {
    return _syncInProgress;
  }

  // ========== CRDT 同步方法 ==========

  // CRDT 同步 - 推送待同步操作日志
  async function crdtPush() {
    var pending = await CRDTLog.getPending();
    if (pending.length === 0) return true;

    var url = _getBaseUrl() + '/api/sync/crdt-push';
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('papacheck_token') || '') },
      body: JSON.stringify({ operations: pending })
    });
    if (!resp.ok) throw new Error('CRDT push failed: ' + resp.status);
    var result = await resp.json();

    // 标记已推送的操作
    for (var i = 0; i < pending.length; i++) {
      await CRDTLog.ack(pending[i].id);
    }

    return result.ok === true;
  }

  // CRDT 同步 - 简化后仅全量拉取（删除前端 CRDT 合并空壳）
  async function crdtPull() {
    await _refreshFromServer();
    return true;
  }

  // 内部方法：从服务器拉取全量数据并缓存到本地
  async function _refreshFromServer() {
    try {
      var url = _getBaseUrl() + '/api/data';
      var resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('papacheck_token') || '') } });
      if (resp.ok) {
        var serverData = await resp.json();
        await DB.cacheFullData(serverData);
        await CRDTLog.cleanup();
      }
    } catch (e) {
      console.warn('[SyncEngine] _refreshFromServer 全量刷新失败，下次轮询将重试:', e);
    }
  }

  // CRDT 全量同步（替代旧的 fullSync）
  async function crdtFullSync() {
    // 超时强制释放：防止 Android WebView 锁屏后 fetch 挂起导致死锁
    if (_syncInProgress) {
      if (Date.now() - _syncStartedAt > _SYNC_LOCK_TIMEOUT) {
        console.warn('[SyncEngine] 锁超时，强制释放');
        _syncInProgress = false;
      } else {
        return false;
      }
    }
    _syncInProgress = true;
    var startedAt = Date.now();
    _syncStartedAt = startedAt;

    try {
      // 1. 推送本地操作日志
      await crdtPush();
      // 2. 拉取远程操作日志
      await crdtPull();
      // 3. 更新上次同步时间
      var serverTime = new Date().toISOString();
      await _saveLastSyncTime(serverTime);
      return true;
    } catch (e) {
      console.error('CRDT sync failed:', e);
      return false;
    } finally {
      // 仅在当前调用仍持有锁时释放，防止超时后被其他调用获取的锁被误释放
      if (_syncStartedAt === startedAt) {
        _syncInProgress = false;
      }
    }
  }

  // 新增：供 connection.js 在 timeout 分支后主动调用
  function forceReleaseLock() {
    if (_syncInProgress) {
      console.warn('[SyncEngine] 外部强制释放锁');
      _syncInProgress = false;
    }
  }

  return {
    crdtPush: crdtPush,
    crdtPull: crdtPull,
    crdtFullSync: crdtFullSync,
    getLastSyncTime: getLastSyncTime,
    isSyncing: isSyncing,
    forceReleaseLock: forceReleaseLock,
  };
})();
