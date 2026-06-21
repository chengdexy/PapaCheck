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
      if (resp.status === 401) {
        // 未认证，跳转到登录页
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        return false;
      }
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
    // 保存当前 childId，_doReconnect 中的 API.getData() 不带参数会导致
    // window._currentChildId 被设为 undefined，丢失父端的子选择隔离
    var savedChildId = (typeof window !== 'undefined') ? window._currentChildId : undefined;
    try {
      var crdtOk = false;
      var crdtAttempted = false;
      var syncPromise = (async function () {
        // 首先尝试 CRDT 同步
        if (typeof SyncEngine !== 'undefined' && SyncEngine.crdtFullSync) {
          crdtAttempted = true;
          try {
            crdtOk = await SyncEngine.crdtFullSync();
          } catch (crdtErr) {
            console.error('[ConnectionManager] CRDT 同步失败:', crdtErr);
          }
        }
        // 尝试使用 getData 刷新数据（不强制依赖 CRDT 成功）
        if (typeof API !== 'undefined' && API.getData) {
          try {
            cachedData = await API.getData();
          } catch (e) {
            // API.getData 失败时回退到本地缓存
            var _hasCachedData = false;
            try { _hasCachedData = typeof cachedData !== 'undefined'; } catch (e2) {}
            if (typeof DB !== 'undefined' && DB.getFullData && _hasCachedData) {
              cachedData = await DB.getFullData();
            }
          }
        }
      })();
      var raceResult = await Promise.race([
        syncPromise,
        new Promise(function (resolve) {
          setTimeout(function () { resolve('timeout'); }, _getReconnectTimeout());
        })
      ]);
      if (raceResult === 'timeout') {
        console.warn('[ConnectionManager] 同步超时，部分操作可能未完全同步');
        if (typeof SyncEngine !== 'undefined' && SyncEngine.forceReleaseLock) {
          SyncEngine.forceReleaseLock();
        }
        _mode = 'offline';
        return;
      }
      if (crdtAttempted && !crdtOk && raceResult !== 'timeout') {
        console.warn('[ConnectionManager] CRDT 同步失败，尝试降级刷新数据...');
        if (typeof API !== 'undefined' && API.getData) {
          try { cachedData = await API.getData(); } catch (e) {
            console.error('[ConnectionManager] getData 降级也失败:', e);
          }
        }
      }
      _mode = 'online';
      _wasOnline = true;
    } catch (syncErr) {
      _mode = 'offline';
      if (typeof showToast === 'function') {
        showToast('同步失败，继续使用离线模式');
      }
    } finally {
      // 恢复 childId，防止 API.getData() 把它清成了 undefined
      if (typeof window !== 'undefined' && savedChildId !== undefined) {
        window._currentChildId = savedChildId;
      }
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
