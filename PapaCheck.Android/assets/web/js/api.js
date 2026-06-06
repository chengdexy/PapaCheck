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
      if (mode === 'offline') {
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
      if (mode === 'offline') {
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
    var resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!resp.ok) throw new Error(resp.statusText);
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
      try { await DB.cacheFullData(result); } catch (e) { }
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
};
