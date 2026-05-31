/**
 * change-log.js - 离线变更日志模块 (offline-first)
 * 记录本地数据修改，以便恢复在线后同步到服务器
 * 依赖: localforage (CDN, 在 index.html 中先于本文件加载)
 */

var ChangeLog = (function() {
  var _store = null;
  var _nextId = 1;

  function _init() {
    _store = localforage.createInstance({ name: 'papacheck_changelog' });
  }

  var _initialized = false;
  async function _ensureInit() {
    if (!_initialized) {
      _init();
      var savedId = await _store.getItem('_nextId');
      if (savedId) _nextId = savedId;
      _initialized = true;
    }
  }

  async function add(type, uuid, data) {
    await _ensureInit();
    var id = _nextId++;
    var record = {
      id: id,
      type: type,
      uuid: uuid,
      data: data,
      timestamp: new Date().toISOString()
    };
    await _store.setItem('change_' + id, record);
    await _store.setItem('_nextId', _nextId);
    return record;
  }

  async function getPending() {
    await _ensureInit();
    var changes = [];
    await _store.iterate(function(value, key) {
      if (key.indexOf('change_') === 0) {
        changes.push(value);
      }
    });
    changes.sort(function(a, b) { return a.id - b.id; });
    return changes;
  }

  async function clear() {
    await _ensureInit();
    var keys = [];
    await _store.iterate(function(value, key) {
      if (key.indexOf('change_') === 0) {
        keys.push(key);
      }
    });
    for (var i = 0; i < keys.length; i++) {
      await _store.removeItem(keys[i]);
    }
    _nextId = 1;
    await _store.setItem('_nextId', 1);
  }

  async function count() {
    await _ensureInit();
    var c = 0;
    await _store.iterate(function(value, key) {
      if (key.indexOf('change_') === 0) {
        c++;
      }
    });
    return c;
  }

  _init();

  return {
    add: add,
    getPending: getPending,
    clear: clear,
    count: count
  };
})();
