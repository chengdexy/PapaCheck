/**
 * sync.js - 同步引擎
 * 负责检测服务端在线状态，上传本地变更，拉取远程变更，LWW 冲突解决
 */
var SyncEngine = (function() {
  var _syncInProgress = false;
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

  async function pushChanges() {
    var pending = await ChangeLog.getPending();
    if (pending.length === 0) return 0;

    var maxPushedId = pending[pending.length - 1].id;

    var url = _getBaseUrl() + '/api/sync/push';
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: pending })
    });
    if (!resp.ok) throw new Error('Push failed: ' + resp.status);
    var result = await resp.json();
    if (result.ok !== true) throw new Error('Push response not ok');
    return maxPushedId;
  }

  async function pullChanges(lastSync) {
    var ts = lastSync || _lastSyncTime || '1970-01-01T00:00:00.000Z';
    var url = _getBaseUrl() + '/api/sync/pull?lastSync=' + encodeURIComponent(ts);

    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var resp = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!resp.ok) throw new Error('Pull failed: ' + resp.status);
        var result = await resp.json();

        var remoteChanges = result.changes || [];
        var serverTime = result.serverTime;

        if (remoteChanges.length > 0) {
          await _applyRemoteChanges(remoteChanges);
        }

        return serverTime;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise(function(r) { setTimeout(r, 1000); });
      }
    }
  }

  async function _applyRemoteChanges(changes) {
    var localData = await DB.getFullData();

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var tableName = change.table_name;
      var recordKey = change.record_key;
      var remoteData = change.data;
      var remoteTime = change.last_modified;

      _mergeIntoLocal(localData, tableName, recordKey, remoteData, remoteTime);
    }

    await DB.cacheFullData(localData);
  }

  function _mergeIntoLocal(localData, tableName, recordKey, remoteData, remoteTime) {
    if (tableName === 'homeworks') {
      _mergeArrayByUuid(localData, 'homeworks', recordKey, remoteData, remoteTime);
    } else if (tableName === 'free_time_tasks') {
      _mergeArrayByUuid(localData, 'freeTimeTasks', recordKey, remoteData, remoteTime);
    } else if (tableName === 'bounty_submissions') {
      _mergeArrayByUuid(localData, 'bountySubmissions', recordKey, remoteData, remoteTime);
    } else if (tableName === 'bounty_completions') {
      if (!localData.bountyCompletions) localData.bountyCompletions = {};
      localData.bountyCompletions[recordKey] = remoteData;
    } else if (tableName === 'daily_settlement') {
      if (!localData.dailySettlement) localData.dailySettlement = {};
      _mergeByUuidOrReplace(localData.dailySettlement, recordKey, remoteData, remoteTime);
    } else if (tableName === 'efficiency_history') {
      if (!localData.efficiencyHistory) localData.efficiencyHistory = {};
      localData.efficiencyHistory[recordKey] = remoteData;
    } else if (tableName === 'shop_items') {
      _mergeArrayByUuid(localData, 'shopItems', null, remoteData, remoteTime);
    } else if (tableName === 'redemptions') {
      _mergeArrayByUuid(localData, 'redemptions', null, remoteData, remoteTime);
    } else if (tableName === 'reward_box') {
      _mergeArrayByUuid(localData, 'rewardBox', null, remoteData, remoteTime);
    } else if (tableName === 'active_buffs') {
      _mergeArrayByUuid(localData, 'activeBuffs', null, remoteData, remoteTime);
    } else if (tableName === 'bounty_tasks') {
      _mergeArrayByUuid(localData, 'bountyTasks', null, remoteData, remoteTime);
    } else if (tableName === 'settings') {
      localData.settings = remoteData;
    } else if (tableName === 'badges') {
      localData.badges = remoteData;
    } else if (tableName === 'points') {
      localData.points = remoteData;
    }
  }

  function _mergeByUuidOrReplace(targetObj, key, remoteData, remoteTime) {
    var localVal = targetObj[key];
    if (!localVal) {
      targetObj[key] = remoteData;
      return;
    }
    var localTime = localVal.lastModified || '1970-01-01T00:00:00.000Z';
    if (remoteTime >= localTime) {
      targetObj[key] = remoteData;
    }
  }

  function _mergeArrayByUuid(localData, localKey, recordKey, remoteData, remoteTime) {
    if (!localData[localKey]) localData[localKey] = {};

    var localArray;
    if (recordKey) {
      if (!localData[localKey][recordKey]) localData[localKey][recordKey] = [];
      localArray = localData[localKey][recordKey];
    } else {
      localArray = localData[localKey];
      if (!Array.isArray(localArray)) localArray = [];
    }

    if (!Array.isArray(remoteData)) {
      _mergeSingleItemIntoArray(localArray, remoteData, remoteTime);
    } else {
      for (var i = 0; i < remoteData.length; i++) {
        _mergeSingleItemIntoArray(localArray, remoteData[i], remoteTime);
      }
    }

    if (!recordKey) {
      localData[localKey] = localArray;
    }
  }

  function _mergeSingleItemIntoArray(localArray, remoteItem, remoteTime) {
    if (!remoteItem || (!remoteItem.uuid && !remoteItem.id)) {
      localArray.push(remoteItem);
      return;
    }

    var matchId = remoteItem.uuid || remoteItem.id;
    var existingIdx = -1;
    for (var i = 0; i < localArray.length; i++) {
      if (localArray[i].uuid === matchId || localArray[i].id === matchId) {
        existingIdx = i;
        break;
      }
    }

    if (existingIdx === -1) {
      localArray.push(remoteItem);
    } else {
      var localTime = localArray[existingIdx].lastModified || '1970-01-01T00:00:00.000Z';
      if (remoteTime >= localTime) {
        localArray[existingIdx] = remoteItem;
      }
    }
  }

  async function fullSync() {
    if (_syncInProgress) return false;
    _syncInProgress = true;

    try {
      var maxPushedId = await pushChanges();

      var serverTime = await pullChanges(_lastSyncTime);

      if (maxPushedId > 0) {
        await ChangeLog.clearUpTo(maxPushedId);
      }

      _lastSyncTime = serverTime || new Date().toISOString();
      await _saveLastSyncTime(_lastSyncTime);

      try {
        var url = _getBaseUrl() + '/api/data';
        var resp = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (resp.ok) {
          var serverData = await resp.json();
          await DB.cacheFullData(serverData);
        }
      } catch (e) {
        // Server data fetch is best-effort after sync
      }

      return true;
    } catch (e) {
      console.error('Sync failed:', e);
      return false;
    } finally {
      _syncInProgress = false;
    }
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
      headers: { 'Content-Type': 'application/json' },
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

  // CRDT 同步 - 拉取远程操作并在本地合并
  async function crdtPull() {
    var lastSync = await getLastSyncTime() || '1970-01-01T00:00:00.000Z';
    var url = _getBaseUrl() + '/api/sync/crdt-pull?since=' + encodeURIComponent(lastSync);

    var resp = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!resp.ok) throw new Error('CRDT pull failed: ' + resp.status);
    var result = await resp.json();

    var operations = result.operations || [];
    if (operations.length === 0) {
      // 无远程变更时仍刷新全量数据
      await _refreshFromServer();
      return true;
    }

    // 在本地 IndexedDB 中应用远程操作
    var localData = await DB.getFullData();
    for (var i = 0; i < operations.length; i++) {
      var op = operations[i];
      // 根据操作类型更新本地数据
      // applyOperation 在服务端已执行，这里只需重新读取全量数据
    }
    // 重新拉取全量数据（后续可优化为增量应用）
    await _refreshFromServer();

    return true;
  }

  // 内部方法：从服务器拉取全量数据并缓存到本地
  async function _refreshFromServer() {
    try {
      var url = _getBaseUrl() + '/api/data';
      var resp = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
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
    if (_syncInProgress) return false;
    _syncInProgress = true;

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
      _syncInProgress = false;
    }
  }

  return {
    pushChanges: pushChanges,
    pullChanges: pullChanges,
    fullSync: fullSync,
    crdtPush: crdtPush,
    crdtPull: crdtPull,
    crdtFullSync: crdtFullSync,
    getLastSyncTime: getLastSyncTime,
    isSyncing: isSyncing,
  };
})();
