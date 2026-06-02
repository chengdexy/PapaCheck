var ConnectionManager = (function () {
  var _mode = 'offline';
  var _pingTimer = null;
  var _pingIntervalMs = 3000;
  var _failCount = 0;
  var _syncing = false;
  var _wasOnline = false;

  function getMode() {
    return _mode;
  }

  var _pingTimeoutMs = 3000;
  var _reconnectTimeoutMs = 10000;

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
        setTimeout(function () { resolve(false); }, _pingTimeoutMs);
      })
    ]);
  }

  async function _doReconnect() {
    if (_syncing) return;
    _syncing = true;
    _mode = 'reconnecting';
    showReconnectMask();
    updateConnStatus();
    try {
      var syncPromise = (async function () {
        if (typeof SyncEngine !== 'undefined' && SyncEngine.fullSync) {
          await SyncEngine.fullSync();
        }
        if (typeof API !== 'undefined' && API.getData) {
          var serverData = await API.getData();
          if (typeof cachedData !== 'undefined') {
            cachedData = serverData;
          }
        }
      })();
      await Promise.race([
        syncPromise,
        new Promise(function (resolve) {
          setTimeout(function () { resolve('timeout'); }, _reconnectTimeoutMs);
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
        }
        hideReconnectMask();
        updateConnStatus();
        resolve();
      });
    });

    _pingTimer = setInterval(async function () {
      var ok = await _ping();
      if (ok) {
        if (_mode === 'offline' && !_syncing) {
          if (_wasOnline) {
            await _doReconnect();
          } else {
            _syncing = true;
            _mode = 'online';
            showReconnectMask();
            updateConnStatus();
            try {
              var firstSyncPromise = (async function () {
                if (typeof SyncEngine !== 'undefined' && SyncEngine.fullSync) {
                  await SyncEngine.fullSync();
                }
                if (typeof API !== 'undefined' && API.getData) {
                  var serverData = await API.getData();
                  if (typeof cachedData !== 'undefined') {
                    cachedData = serverData;
                  }
                }
              })();
              await Promise.race([
                firstSyncPromise,
                new Promise(function (resolve) {
                  setTimeout(function () { resolve('timeout'); }, _reconnectTimeoutMs);
                })
              ]);
              _wasOnline = true;
            } catch (syncErr) {
              _mode = 'offline';
            } finally {
              hideReconnectMask();
              updateConnStatus();
              _syncing = false;
            }
          }
        } else if (_mode === 'reconnecting') {
          _mode = 'online';
          hideReconnectMask();
          updateConnStatus();
        } else {
          _mode = 'online';
          updateConnStatus();
        }
      } else {
        var wasOnline = _mode === 'online';
        _mode = 'offline';
        updateConnStatus();
        if (wasOnline && typeof showToast === 'function') {
          showToast('\u7f51\u7edc\u8fde\u63a5\u65ad\u5f00\uff0c\u4f7f\u7528\u7f13\u5b58\u6570\u636e');
        }
      }
    }, _pingIntervalMs);

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

  function showReconnectMask() {
    var mask = document.getElementById('reconnectMask');
    if (!mask) return;
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
