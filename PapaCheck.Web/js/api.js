function getAuthHeaders() {
  try {
    const token = localStorage.getItem('papacheck_token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
  } catch (e) {
    return {};
  }
}

let isServerMode = false;
let cachedData = null;

function updateConnStatus() {
  const el = document.getElementById('connStatus');
  if (!el) return;
  if (isServerMode) {
    el.textContent = '🟢';
    el.className = 'conn-status online';
    el.title = '已连接服务器 · 数据实时同步';
  } else {
    el.textContent = '🟡';
    el.className = 'conn-status offline';
    el.title = '离线缓存模式 · 使用本地缓存数据';
  }
}

const API = {
  // ========== 统一请求策略处理器 ==========

  _strategies: {
    // 优先在线，失败降级到本地
    'online-first': async function (onlineFn, offlineFn, options) {
      var mode = ConnectionManager.getMode();
      if (mode === 'offline' || mode === 'reconnecting') {
        return await offlineFn();
      }
      try {
        var result = await onlineFn();
        if (options.syncToLocal && offlineFn) {
          try { await offlineFn(); } catch (e) { }
        }
        return result;
      } catch (err) {
        if (!options.allowFallback) throw err;
        if (options.onOnlineError) options.onOnlineError(err);
        return await offlineFn();
      }
    },

    // 仅在线模式，不允许降级
    'online-only': async function (onlineFn, offlineFn, options) {
      var mode = ConnectionManager.getMode();
      if (mode === 'offline' || mode === 'reconnecting') {
        throw new Error('当前为离线模式，无法完成此操作');
      }
      return await onlineFn();
    },

    // 仅离线模式
    'offline-only': async function (onlineFn, offlineFn, options) {
      return await offlineFn();
    },
  },

  async _requestWithStrategy(strategy, onlineFn, offlineFn, options) {
    if (!options) options = {};
    var strategyFn = this._strategies[strategy] || this._strategies['online-first'];
    return await strategyFn(onlineFn, offlineFn, options);
  },

  async _fetch(url, options) {
    if (!options) options = {};
    var method = options.method || 'GET';
    var fetchOptions = { ...options };
    // DELETE 请求没有 body，不设置 Content-Type，避免 Fastify 报空 JSON body 错误
    if (method !== 'DELETE') {
      if (!fetchOptions.headers) fetchOptions.headers = {};
      if (!fetchOptions.headers['Content-Type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }
    // 注入 Bearer token
    if (!fetchOptions.headers) fetchOptions.headers = {};
    Object.assign(fetchOptions.headers, getAuthHeaders());
    var resp = await fetch(url, fetchOptions);
    // 未认证，跳转到登录页
    if (resp.status === 401) {
      window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
      throw new Error('unauthorized');
    }
    if (!resp.ok) throw new Error(resp.statusText);
    if (resp.status === 204 || resp.status === 205) return null;
    return await resp.json();
  },

  // ========== 数据获取 ==========

  async getData() {
    // getData 是初始化函数，在 ConnectionManager.start() 之前调用，
    // 此时 CM 模式为 offline，但服务器可能在线，因此不依赖 CM 模式判断
    try {
      var result = await this._fetch('/api/data');
      isServerMode = true;
      cachedData = result;
      // 深拷贝后传给 cacheFullData，防止原地修改 lastModified/uuid 污染 cachedData
      try { await DB.cacheFullData(JSON.parse(JSON.stringify(result))); } catch (e) { }
      return result;
    } catch (e) {
      var localData = await DB.getFullData();
      if (localData && Object.keys(localData).length > 0) {
        isServerMode = false;
        cachedData = localData;
        return localData;
      }
      throw e;
    }
  },

  async getTasks(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/tasks/' + dateKey),
      async () => {
        var data = await DB.getFullData();
        return (data.homeworks && data.homeworks[dateKey]) ? data.homeworks[dateKey] : [];
      },
      { allowFallback: true }
    );
  },

  async getHomeworks(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/homeworks/' + dateKey),
      async () => await DB.getHomeworks(dateKey),
      { allowFallback: true }
    );
  },

  async saveHomeworks(dateKey, list) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/homeworks', {
          method: 'PUT',
          body: JSON.stringify({ dateKey: dateKey, homeworks: list }),
        });
        return true;
      },
      async () => {
        await DB.saveHomeworks(dateKey, list);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getSettlement(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/settlement/' + dateKey),
      async () => await DB.getSettlement(dateKey),
      { allowFallback: true }
    );
  },

  async saveSettlement(dateKey, settlementData) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/settlement/' + dateKey, {
          method: 'PUT',
          body: JSON.stringify({ settlement: settlementData }),
        });
        return true;
      },
      async () => {
        await DB.saveSettlement(dateKey, settlementData);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async updatePoints(action, amount, detail) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        var result = await this._fetch('/api/points', {
          method: 'PATCH',
          body: JSON.stringify({ action, amount, detail }),
        });
        try {
          var pts = await DB.getPoints();
          pts.balance = result.balance;
          await DB.savePoints(pts);
        } catch (e) { }
        return result.balance;
      },
      async () => {
        var localPts = await DB.getPoints() || { balance: 0, history: [] };
        if (action === 'spend') {
          localPts.balance -= amount;
        } else {
          localPts.balance += amount;
        }
        await DB.savePoints(localPts);
        return localPts.balance;
      },
      { allowFallback: true }
    );
  },

  async getRedemptions() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/redemptions'),
      async () => await DB.getRedemptions(),
      { allowFallback: true }
    );
  },

  async saveRedemptions(list) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/redemptions', {
          method: 'PUT',
          body: JSON.stringify({ redemptions: list }),
        });
        return true;
      },
      async () => {
        await DB.saveRedemptions(list);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async clearRedemptionHistory() {
    return await this._requestWithStrategy(
      'online-only',
      async () => {
        await this._fetch('/api/redemptions/fulfilled', { method: 'DELETE' });
        return true;
      },
      null,
      {}
    );
  },

  async getRewardBox() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/reward-box'),
      async () => await DB.getRewardBox(),
      { allowFallback: true }
    );
  },

  async saveRewardBox(items) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/reward-box', {
          method: 'PUT',
          body: JSON.stringify({ items }),
        });
        return true;
      },
      async () => {
        await DB.saveRewardBox(items);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getSettings() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/settings'),
      async () => await DB.getSettings(),
      { allowFallback: true }
    );
  },

  async saveSettings(settings) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ settings }),
        });
        return true;
      },
      async () => {
        await DB.saveSettings(settings);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getActiveBuffs() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/active-buffs'),
      async () => await DB.getActiveBuffs(),
      { allowFallback: true }
    );
  },

  async saveActiveBuffs(buffs) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/active-buffs', {
          method: 'PUT',
          body: JSON.stringify({ buffs }),
        });
        return true;
      },
      async () => {
        await DB.saveActiveBuffs(buffs);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getShopItems() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/shop'),
      async () => await DB.getShopItems(),
      { allowFallback: true }
    );
  },

  async saveShopItems(items) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/shop', {
          method: 'PUT',
          body: JSON.stringify({ items }),
        });
        return true;
      },
      async () => {
        await DB.saveShopItems(items);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getEfficiency(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/efficiency/' + dateKey),
      async () => await DB.getEfficiency(dateKey),
      { allowFallback: true }
    );
  },

  async saveEfficiency(dateKey, efficiencyData) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/efficiency/' + dateKey, {
          method: 'PUT',
          body: JSON.stringify({ efficiency: efficiencyData }),
        });
        return true;
      },
      async () => {
        await DB.saveEfficiency(dateKey, efficiencyData);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getFreeTime(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/freetime/' + dateKey),
      async () => await DB.getFreeTime(dateKey),
      { allowFallback: true }
    );
  },

  async saveFreeTime(dateKey, tasks) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/freetime', {
          method: 'PUT',
          body: JSON.stringify({ dateKey, tasks }),
        });
        return true;
      },
      async () => {
        await DB.saveFreeTime(dateKey, tasks);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async deferHomework(dateKey, hwId, action, requestedAt) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        return await this._fetch('/api/defer-homework', {
          method: 'POST',
          body: JSON.stringify({ date: dateKey, hwId, action, requestedAt }),
        });
      },
      async () => {
        var homeworks = await DB.getHomeworks(dateKey);
        var hw = homeworks.find(function (h) { return h.id === hwId; });
        if (hw && action === 'request') {
          hw.deferRequest = { requestedAt: requestedAt, status: 'pending' };
          await DB.saveHomeworks(dateKey, homeworks);
        }
        return { ok: true };
      },
      { allowFallback: true }
    );
  },

  async getBountyTasks() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/bounty-tasks'),
      async () => await DB.getBountyTasks(),
      { allowFallback: true }
    );
  },

  async saveBountyTasks(items) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-tasks', {
          method: 'PUT',
          body: JSON.stringify({ items }),
        });
        return true;
      },
      async () => {
        await DB.saveBountyTasks(items);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getBountySubmissions(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/bounty-submissions/' + dateKey),
      async () => await DB.getBountySubmissions(dateKey),
      { allowFallback: true }
    );
  },

  async saveBountySubmissions(dateKey, submissions) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-submissions', {
          method: 'PUT',
          body: JSON.stringify({ dateKey, submissions }),
        });
        return true;
      },
      async () => {
        await DB.saveBountySubmissions(dateKey, submissions);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async getBountyCompletions(dateKey) {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/bounty-completions/' + dateKey),
      async () => await DB.getBountyCompletions(dateKey),
      { allowFallback: true }
    );
  },

  async saveBountyCompletions(dateKey, completions) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-completions', {
          method: 'PUT',
          body: JSON.stringify({ dateKey, completions }),
        });
        return true;
      },
      async () => {
        await DB.saveBountyCompletions(dateKey, completions);
        return true;
      },
      { syncToLocal: true, allowFallback: true }
    );
  },

  async resetDate(date) {
    return await this._requestWithStrategy(
      'online-only',
      async () => {
        return await this._fetch('/api/reset-date', {
          method: 'POST',
          body: JSON.stringify({ date: date }),
        });
      },
      null,
      {}
    );
  },

  // ========== PUT / PATCH / DELETE / HEAD ==========

  // ---- 作业 (homeworks) ----

  async putHomework(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'homeworks', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/homeworks/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var dk = data.dateKey || data.date || new Date().toISOString().slice(0, 10);
          var list = await DB.getHomeworks(dk);
          var idx = list.findIndex(function (h) { return h.id === id || h.uuid === id; });
          if (idx !== -1) { list[idx] = data; }
          else { list.push(data); }
          await DB.saveHomeworks(dk, list);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async patchHomework(id, fields, dateKey) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'homeworks', resourceId: id, field: null, value: fields }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/homeworks/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中部分更新该作业
        if (dateKey) {
          try {
            var list = await DB.getHomeworks(dateKey);
            var idx = list.findIndex(function (h) { return h.id === id || h.uuid === id; });
            if (idx !== -1) {
              Object.assign(list[idx], fields);
              await DB.saveHomeworks(dateKey, list);
            }
            return true;
          } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
        }
        return true;
      },
      { allowFallback: true }
    );
  },

  async deleteHomework(id, dateKey) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'delete', table: 'homeworks', resourceId: id, field: null, value: null }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/homeworks/' + id, { method: 'DELETE' });
        return true;
      },
      async () => {
        // 离线降级：从本地缓存中删除该作业
        if (dateKey) {
          try {
            var list = await DB.getHomeworks(dateKey);
            var idx = list.findIndex(function (h) { return h.id === id || h.uuid === id; });
            if (idx !== -1) {
              list.splice(idx, 1);
              await DB.saveHomeworks(dateKey, list);
            }
            return true;
          } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
        }
        return true;
      },
      { allowFallback: true }
    );
  },

  async headHomework(id) {
    var mode = ConnectionManager.getMode();
    if (mode === 'offline') return false;
    try {
      var resp = await fetch('/api/homeworks/' + id, { method: 'HEAD', headers: getAuthHeaders() });
      return resp.ok;
    } catch (e) {
      return false;
    }
  },

  // ---- 结算 (settlement) ----

  async putSettlement(dateKey, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'daily_settlement', resourceId: dateKey, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/settlement/' + dateKey, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try { await DB.saveSettlement(dateKey, data); return true; } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async patchSettlement(dateKey, fields) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'daily_settlement', resourceId: dateKey, field: null, value: fields }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-only',
      async () => {
        await this._fetch('/api/settlement/' + dateKey, { method: 'PATCH', body: JSON.stringify(fields) });
        return true;
      },
      null,
      {}
    );
  },

  // ---- 积分 (points) ----

  async patchPoints(delta) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'points', resourceId: 'points', field: null, value: delta }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-only',
      async () => {
        var result = await this._fetch('/api/points', { method: 'PATCH', body: JSON.stringify(delta) });
        return result.balance;
      },
      null,
      {}
    );
  },

  // ---- 商店 (shop) ----

  async putShopItem(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'shop_items', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/shop/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var items = await DB.getShopItems();
          var idx = items.findIndex(function (s) { return s.id === id || s.uuid === id; });
          if (idx !== -1) items[idx] = data;
          else items.push(data);
          await DB.saveShopItems(items);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async deleteShopItem(id) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'delete', table: 'shop_items', resourceId: id, field: null, value: null }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/shop/' + id, { method: 'DELETE' });
        return true;
      },
      async () => {
        // 离线降级：从本地缓存中删除该商品
        try {
          var items = await DB.getShopItems();
          var idx = items.findIndex(function (s) { return s.id === id || s.uuid === id; });
          if (idx !== -1) {
            items.splice(idx, 1);
            await DB.saveShopItems(items);
          }
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async headShopItem(id) {
    var mode = ConnectionManager.getMode();
    if (mode === 'offline') return false;
    try {
      var resp = await fetch('/api/shop/' + id, { method: 'HEAD', headers: getAuthHeaders() });
      return resp.ok;
    } catch (e) {
      return false;
    }
  },

  // ---- 兑换 (redemptions) ----

  async putRedemption(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'redemptions', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/redemptions/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var items = await DB.getRedemptions();
          var idx = items.findIndex(function (r) { return r.id === id || r.uuid === id; });
          if (idx !== -1) items[idx] = data;
          else items.push(data);
          await DB.saveRedemptions(items);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  // ---- 奖励箱 (reward-box) ----

  async putRewardBoxItem(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'reward_box', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/reward-box/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var items = await DB.getRewardBox();
          var idx = items.findIndex(function (r) { return r.id === id || r.uuid === id; });
          if (idx !== -1) items[idx] = data;
          else items.push(data);
          await DB.saveRewardBox(items);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async deleteRewardBoxItem(id) {
    // 添加 CRDT 删除操作日志
    try { var op = { type: 'delete', table: 'reward_box', resourceId: id, field: null, value: null }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/reward-box/' + id, { method: 'DELETE' });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中删除
        try {
          var items = await DB.getRewardBox();
          var idx = items.findIndex(function (r) { return r.id === id || r.uuid === id; });
          if (idx !== -1) {
            items.splice(idx, 1);
            await DB.saveRewardBox(items);
          }
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  // ---- 设置 (settings) ----

  async putSettings(data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'settings', resourceId: 'settings', field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/settings', { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try { await DB.saveSettings(data); return true; } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async patchSettings(fields) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'settings', resourceId: 'settings', field: null, value: fields }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-only',
      async () => {
        await this._fetch('/api/settings', { method: 'PATCH', body: JSON.stringify(fields) });
        return true;
      },
      null,
      {}
    );
  },

  // ---- Buff (active-buffs) ----

  async putBuff(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'active_buffs', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/active-buffs/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var items = await DB.getActiveBuffs();
          var idx = items.findIndex(function (b) { return b.id === id || b.uuid === id; });
          if (idx !== -1) items[idx] = data;
          else items.push(data);
          await DB.saveActiveBuffs(items);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async deleteBuff(id) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'delete', table: 'active_buffs', resourceId: id, field: null, value: null }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/active-buffs/' + id, { method: 'DELETE' });
        return true;
      },
      async () => {
        // 离线降级：从本地缓存中删除该 Buff
        try {
          var buffs = await DB.getActiveBuffs();
          var idx = buffs.findIndex(function (b) { return b.id === id || b.uuid === id; });
          if (idx !== -1) {
            buffs.splice(idx, 1);
            await DB.saveActiveBuffs(buffs);
          }
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  // ---- 效率 (efficiency) ----

  async putEfficiency(dateKey, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'efficiency_history', resourceId: dateKey, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/efficiency/' + dateKey, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try { await DB.saveEfficiency(dateKey, data); return true; } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  // ---- 自由时间 (freetime) ----

  async putFreeTimeTask(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'free_time_tasks', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/freetime/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var dk = data.dateKey || data.date || new Date().toISOString().slice(0, 10);
          var list = await DB.getFreeTime(dk);
          var idx = list.findIndex(function (t) { return t.id === id || t.uuid === id; });
          if (idx !== -1) list[idx] = data;
          else list.push(data);
          await DB.saveFreeTime(dk, list);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  // ---- 赏金任务 (bounty-tasks) ----

  async putBountyTask(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'bounty_tasks', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-tasks/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var items = await DB.getBountyTasks();
          var idx = items.findIndex(function (t) { return t.id === id || t.uuid === id; });
          if (idx !== -1) items[idx] = data;
          else items.push(data);
          await DB.saveBountyTasks(items);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async deleteBountyTask(id) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'delete', table: 'bounty_tasks', resourceId: id, field: null, value: null }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-tasks/' + id, { method: 'DELETE' });
        return true;
      },
      async () => {
        // 离线降级：从本地缓存中删除该赏金任务
        try {
          var tasks = await DB.getBountyTasks();
          var idx = tasks.findIndex(function (t) { return t.id === id || t.uuid === id; });
          if (idx !== -1) {
            tasks.splice(idx, 1);
            await DB.saveBountyTasks(tasks);
          }
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  async headBountyTask(id) {
    var mode = ConnectionManager.getMode();
    if (mode === 'offline') return false;
    try {
      var resp = await fetch('/api/bounty-tasks/' + id, { method: 'HEAD', headers: getAuthHeaders() });
      return resp.ok;
    } catch (e) {
      return false;
    }
  },

  // ---- 赏金提交 (bounty-submissions) ----

  async putBountySubmission(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'bounty_submissions', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-submissions/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try {
          var dk = data.dateKey || data.date || new Date().toISOString().slice(0, 10);
          var list = await DB.getBountySubmissions(dk);
          var idx = list.findIndex(function (s) { return s.id === id || s.uuid === id; });
          if (idx !== -1) list[idx] = data;
          else list.push(data);
          await DB.saveBountySubmissions(dk, list);
          return true;
        } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  // ---- 赏金完成 (bounty-completions) ----

  async putBountyCompletion(id, data) {
    // 添加 CRDT 操作日志
    try { var op = { type: 'update', table: 'bounty_completions', resourceId: id, field: null, value: data }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        await this._fetch('/api/bounty-completions/' + id, { method: 'PUT', body: JSON.stringify(data) });
        return true;
      },
      async () => {
        // 离线降级：在本地 DB 中创建/更新
        try { await DB.saveBountyCompletions(id, data); return true; } catch (e) { console.error('[API] 离线写入失败:', e); return false; }
      },
      { allowFallback: true }
    );
  },

  migrateBountyCompletionsToTotal(data) {
    if (!data || !data.bountyCompletions) return data;
    var comps = data.bountyCompletions;
    if (comps._total) return data;
    var total = {};
    for (var dk of Object.keys(comps)) {
      var entry = comps[dk];
      if (entry && typeof entry === 'object') {
        for (var tid of Object.keys(entry)) {
          if (tid === 'uuid' || tid === 'lastModified' || tid === 'isDeleted' || tid === '_table' || tid === 'date') continue;
          var v = entry[tid];
          var delta = typeof v === 'number' ? v : (v ? 1 : 0);
          total[tid] = (total[tid] || 0) + delta;
        }
      }
    }
    comps._total = total;
    if (Object.keys(total).length > 0) {
      this.saveBountyCompletions('_total', total).catch(function () { });
    }
    return data;
  },

  // ---- 通知 (notifications) ----

  async announce(text) {
    try { var op = { type: 'update', table: 'notifications', resourceId: crypto.randomUUID(), field: null, value: { text, createdAt: Date.now() } }; await CRDTLog.append(op); } catch (e) { console.error('[API] CRDTLog.append 失败:', e); }
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        var result = await this._fetch('/api/notify', { method: 'POST', body: JSON.stringify({ text }) });
        return result;
      },
      async () => {
        // 离线模式：CRDT 日志已记录，不需要额外操作
        return { ok: true };
      },
      { allowFallback: true }
    );
  },

  async getPendingNotifications() {
    return await this._requestWithStrategy(
      'online-first',
      async () => await this._fetch('/api/notify/pending'),
      async () => ({ items: [] }),
      { allowFallback: true }
    );
  },

  async consumeNotifications(ids) {
    return await this._requestWithStrategy(
      'online-first',
      async () => {
        var result = await this._fetch('/api/notify/consumed?ids=' + encodeURIComponent(ids.join(',')), { method: 'DELETE' });
        return result;
      },
      async () => {
        return { ok: true };
      },
      { allowFallback: true }
    );
  },

  // ========== 乐观写入（Phase 1） ==========

  /**
   * 乐观更新：立即更新内存 UI，异步上报，失败回滚
   */
  optimisticWrite: async function (operation, applyToLocal, rollback) {
    applyToLocal();
    try {
      await this.pushOperation(operation);
    } catch (e) {
      rollback();
      if (typeof showToast === 'function') {
        showToast('操作未保存，请检查网络');
      }
    }
  },

  /**
   * 异步上报写操作
   */
  pushOperation: async function (operation) {
    if (window.PapaCheckBridge && window.PapaCheckBridge.enqueue) {
      window.PapaCheckBridge.enqueue(JSON.stringify(operation));
      return { ok: true, queued: true };
    }
    var resp = await fetch('/api/sync/write', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(operation)
    });
    if (!resp.ok) throw new Error('Write failed: ' + resp.status);
    return resp.json();
  },
};
