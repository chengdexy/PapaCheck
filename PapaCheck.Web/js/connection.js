var ConnectionManager = (function () {
  var _mode = 'offline';
  var _pingTimer = null;
  var _failCount = 0;
  var _syncing = false;
  var _wasOnline = false;

  function getMode() {
    return _mode;
  }

  // 测试环境可通过 window.__CM_TEST_CONFIG__ 覆盖超时参数（读取时机为每次调用）
  function _getPingTimeout() {
    return (window.__CM_TEST_CONFIG__ && window.__CM_TEST_CONFIG__.pingTimeoutMs) || 2000;
  }
  function _getReconnectTimeout() {
    return (window.__CM_TEST_CONFIG__ && window.__CM_TEST_CONFIG__.reconnectTimeoutMs) || 10000;
  }
  function _getPingInterval() {
    return (window.__CM_TEST_CONFIG__ && window.__CM_TEST_CONFIG__.pingIntervalMs) || 3000;
  }

  async function _ping() {
    var fetchPromise = fetch('/api/ping', {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }
    }).then(async function (resp) {
      if (!resp.ok) throw new Error('ping failed');
      var data = await resp.json();
      if (data.ok !== true) throw new Error('ping not ok');
      _failCount = 0;
      return true;
    }).catch(function () {
      return false;
    });

    return Promise.race([
      fetchPromise,
      new Promise(function (resolve) {
        setTimeout(function () { resolve(false); }, _getPingTimeout());
      })
    ]);
  }

  async function _doReconnect() {
    if (_syncing) return;
    _syncing = true;
    _mode = 'reconnecting';
    showReconnectMask('\u6b63\u5728\u540c\u6b65\u6570\u636e\u2026');
    updateConnStatus();
    try {
      var syncPromise = (async function () {
        // 首先尝试 CRDT 同步
        var crdtOk = false;
        if (typeof SyncEngine !== 'undefined' && SyncEngine.crdtFullSync) {
          try {
            crdtOk = await SyncEngine.crdtFullSync();
          } catch (crdtErr) {
            // CRDT 同步失败，后续依赖本地缓存数据
          }
        }
        // 从 IndexedDB 读取最新数据（CRDT 成功时已更新，失败时保留本地状态）
        var _hasCachedData = false;
        try { _hasCachedData = typeof cachedData !== 'undefined'; } catch (e) {}
        if (typeof DB !== 'undefined' && DB.getFullData && _hasCachedData) {
          cachedData = await DB.getFullData();
        }
      })();
      await Promise.race([
        syncPromise,
        new Promise(function (resolve) {
          setTimeout(function () { resolve('timeout'); }, _getReconnectTimeout());
        })
      ]);
      _mode = 'online';
      _wasOnline = true;
    } catch (syncErr) {
      _mode = 'offline';
      if (typeof showToast === 'function') {
        showToast('同步失败，继续使用离线模式');
      }
    } finally {
      hideReconnectMask();
      updateConnStatus();
      _syncing = false;
    }
  }

  function start() {
    if (_pingTimer) {
      clearInterval(_pingTimer);
      _pingTimer = null;
    }
    _wasOnline = false;

    var initialPingDone = new Promise(function (resolve) {
      _ping().then(function (ok) {
        if (ok) {
          _mode = 'online';
          _wasOnline = true;
          _failCount = 0;
        } else {
          _failCount++;
        }
        hideReconnectMask();
        updateConnStatus();
        resolve();
      });
    });

    _pingTimer = setInterval(async function () {
      var ok = await _ping();
      if (ok) {
        if (_failCount > 0) {
          hideReconnectMask();
        }
        if (_mode === 'offline' && !_syncing) {
          await _doReconnect();
        } else if (_mode === 'reconnecting') {
          // 重连过程中 ping 持续成功：可能 _doReconnect() 同步超时但连接仍在，
          // 此处不做干预，由 _doReconnect() 的 finally 块决定最终状态
        } else {
          _mode = 'online';
          updateConnStatus();
        }
      } else {
        _failCount++;
        if (_failCount === 1 && _mode === 'online') {
          _mode = 'reconnecting';
          // 第一次 ping 不通时不显示遮罩，第二次 ping 时再显示，降低用户等待体验
          updateConnStatus();
        }
        if (_failCount === 2) {
          showReconnectMask('\u8fde\u63a5\u65ad\u5f00\uff0c\u6b63\u5728\u56fa\u5b9a\u6570\u636e...');
        }
        if (_failCount >= 3) {
          hideReconnectMask();
          var wasOnline = _mode === 'online' || _mode === 'reconnecting';
          _mode = 'offline';
          updateConnStatus();
          if (wasOnline && typeof showToast === 'function') {
            showToast('\u7f51\u7edc\u8fde\u63a5\u65ad\u5f00\uff0c\u4f7f\u7528\u7f13\u5b58\u6570\u636e');
          }
        }
      }
    }, _getPingInterval());

    return initialPingDone;
  }

  function stop() {
    if (_pingTimer) {
      clearInterval(_pingTimer);
      _pingTimer = null;
    }
  }

  function updateConnStatus() {
    var el = document.getElementById('connStatus');
    if (!el) return;
    if (_mode === 'online') {
      el.textContent = '\uD83D\uDFE2';
      el.className = 'conn-status online';
      el.title = '已连接服务器 · 数据实时同步';
      hideReconnectMask();
    } else if (_mode === 'reconnecting') {
      el.textContent = '\uD83D\uDFE1';
      el.className = 'conn-status offline';
      el.title = '正在重新连接…';
    } else {
      el.textContent = '\uD83D\uDFE1';
      el.className = 'conn-status offline';
      el.title = '离线缓存模式 · 使用本地缓存数据';
      hideReconnectMask();
    }
  }

  function showReconnectMask(text) {
    var mask = document.getElementById('reconnectMask');
    if (!mask) return;
    var textEl = mask.querySelector('.transition-text');
    if (textEl && text) textEl.textContent = text;
    mask.style.display = 'flex';
  }

  function hideReconnectMask() {
    var mask = document.getElementById('reconnectMask');
    if (!mask) return;
    mask.style.display = 'none';
  }

  function getWasOnline() {
    return _wasOnline;
  }

  return {
    start: start,
    stop: stop,
    getMode: getMode,
    getWasOnline: getWasOnline
  };
})();
