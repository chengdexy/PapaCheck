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
  async _fetch(url, options = {}) {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!resp.ok) throw new Error(resp.statusText);
    return await resp.json();
  },

  async getData() {
    try {
      const result = await this._fetch('/api/data');
      isServerMode = true;
      cachedData = result;
      try { await DB.cacheFullData(result); } catch (e) { }
      return result;
    } catch (e) {
      try {
        var localData = await DB.getFullData();
        if (localData && Object.keys(localData).length > 0) {
          isServerMode = false;
          cachedData = localData;
          return localData;
        }
      } catch (dbErr) { }
      throw e;
    }
  },

  async getTasks(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      var data = await DB.getFullData();
      return (data.homeworks && data.homeworks[dateKey]) ? data.homeworks[dateKey] : [];
    }
    try {
      return await this._fetch(`/api/tasks/${dateKey}`);
    } catch (e) {
      var data = await DB.getFullData();
      return (data.homeworks && data.homeworks[dateKey]) ? data.homeworks[dateKey] : [];
    }
  },

  async getHomeworks(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getHomeworks(dateKey);
    }
    try {
      return await this._fetch(`/api/homeworks/${dateKey}`);
    } catch (e) {
      return await DB.getHomeworks(dateKey);
    }
  },

  async saveHomeworks(dateKey, list) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch(`/api/homeworks/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ homeworks: list }),
        });
      } catch (e) { }
    }
    await DB.saveHomeworks(dateKey, list);
    return true;
  },

  async getSettlement(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getSettlement(dateKey);
    }
    try {
      return await this._fetch(`/api/settlement/${dateKey}`);
    } catch (e) {
      return await DB.getSettlement(dateKey);
    }
  },

  async saveSettlement(dateKey, settlementData) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch(`/api/settlement/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ settlement: settlementData }),
        });
      } catch (e) { }
    }
    await DB.saveSettlement(dateKey, settlementData);
    return true;
  },

  async updatePoints(action, amount, detail) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        const result = await this._fetch('/api/points', {
          method: 'POST',
          body: JSON.stringify({ action, amount, detail }),
        });
        try {
          var pts = await DB.getPoints();
          pts.balance = result.balance;
          await DB.savePoints(pts);
        } catch (e) { }
        return result.balance;
      } catch (e) { }
    }
    var localPts = await DB.getPoints() || { balance: 0, history: [] };
    if (action === 'spend') {
      localPts.balance -= amount;
    } else {
      localPts.balance += amount;
    }
    await DB.savePoints(localPts);
    return localPts.balance;
  },

  async getRedemptions() {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getRedemptions();
    }
    try {
      return await this._fetch('/api/redemptions');
    } catch (e) {
      return await DB.getRedemptions();
    }
  },

  async saveRedemptions(list) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch('/api/redemptions', {
          method: 'POST',
          body: JSON.stringify({ redemptions: list }),
        });
      } catch (e) { }
    }
    await DB.saveRedemptions(list);
    return true;
  },

  async getRewardBox() {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getRewardBox();
    }
    try {
      return await this._fetch('/api/reward-box');
    } catch (e) {
      return await DB.getRewardBox();
    }
  },

  async saveRewardBox(items) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch('/api/reward-box', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
      } catch (e) { }
    }
    await DB.saveRewardBox(items);
    return true;
  },

  async getSettings() {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getSettings();
    }
    try {
      return await this._fetch('/api/settings');
    } catch (e) {
      return await DB.getSettings();
    }
  },

  async saveSettings(settings) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ settings }),
        });
      } catch (e) { }
    }
    await DB.saveSettings(settings);
    return true;
  },

  async getActiveBuffs() {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getActiveBuffs();
    }
    try {
      return await this._fetch('/api/active-buffs');
    } catch (e) {
      return await DB.getActiveBuffs();
    }
  },

  async saveActiveBuffs(buffs) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch('/api/active-buffs', {
          method: 'POST',
          body: JSON.stringify({ buffs }),
        });
      } catch (e) { }
    }
    await DB.saveActiveBuffs(buffs);
    return true;
  },

  async getShopItems() {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getShopItems();
    }
    try {
      return await this._fetch('/api/shop');
    } catch (e) {
      return await DB.getShopItems();
    }
  },

  async saveShopItems(items) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch('/api/shop', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
      } catch (e) { }
    }
    await DB.saveShopItems(items);
    return true;
  },

  async getEfficiency(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getEfficiency(dateKey);
    }
    try {
      return await this._fetch(`/api/efficiency/${dateKey}`);
    } catch (e) {
      return await DB.getEfficiency(dateKey);
    }
  },

  async saveEfficiency(dateKey, efficiencyData) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch(`/api/efficiency/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ efficiency: efficiencyData }),
        });
      } catch (e) { }
    }
    await DB.saveEfficiency(dateKey, efficiencyData);
    return true;
  },

  async getFreeTime(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getFreeTime(dateKey);
    }
    try {
      return await this._fetch(`/api/freetime/${dateKey}`);
    } catch (e) {
      return await DB.getFreeTime(dateKey);
    }
  },

  async saveFreeTime(dateKey, tasks) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch(`/api/freetime/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ tasks }),
        });
      } catch (e) { }
    }
    await DB.saveFreeTime(dateKey, tasks);
    return true;
  },

  async deferHomework(dateKey, hwId, action, requestedAt) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        return await this._fetch('/api/defer-homework', {
          method: 'POST',
          body: JSON.stringify({ date: dateKey, hwId, action, requestedAt }),
        });
      } catch (e) { }
    }
    var homeworks = await DB.getHomeworks(dateKey);
    var hw = homeworks.find(h => h.id === hwId);
    if (hw && action === 'request') {
      hw.deferRequest = { requestedAt: requestedAt, status: 'pending' };
      await DB.saveHomeworks(dateKey, homeworks);
    }
    return { ok: true };
  },

  async getBountyTasks() {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getBountyTasks();
    }
    try {
      return await this._fetch('/api/bounty-tasks');
    } catch (e) {
      return await DB.getBountyTasks();
    }
  },

  async saveBountyTasks(items) {
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch('/api/bounty-tasks', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
      } catch (e) { }
    }
    await DB.saveBountyTasks(items);
    return true;
  },

  async getBountySubmissions(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getBountySubmissions(dateKey);
    }
    try {
      return await this._fetch(`/api/bounty-submissions/${dateKey}`);
    } catch (e) {
      return await DB.getBountySubmissions(dateKey);
    }
  },

  async saveBountySubmissions(dateKey, submissions) {
    try { await DB.saveBountySubmissions(dateKey, submissions); } catch (e) { }
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch(`/api/bounty-submissions/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ submissions }),
        });
      } catch (e) { }
    }
    return true;
  },

  async getBountyCompletions(dateKey) {
    if (ConnectionManager.getMode() === 'offline') {
      return await DB.getBountyCompletions(dateKey);
    }
    try {
      return await this._fetch(`/api/bounty-completions/${dateKey}`);
    } catch (e) {
      return await DB.getBountyCompletions(dateKey);
    }
  },

  async saveBountyCompletions(dateKey, completions) {
    try { await DB.saveBountyCompletions(dateKey, completions); } catch (e) { }
    if (ConnectionManager.getMode() === 'online') {
      try {
        await this._fetch(`/api/bounty-completions/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ completions }),
        });
      } catch (e) { }
    }
    return true;
  },

  async resetDate(date) {
    if (ConnectionManager.getMode() !== 'online') {
      throw new Error('离线模式不支持重置日期');
    }
    return await this._fetch('/api/reset-date', {
      method: 'POST',
      body: JSON.stringify({ date: date })
    });
  },

  migrateBountyCompletionsToTotal(data) {
    if (!data || !data.bountyCompletions) return data;
    const comps = data.bountyCompletions;
    if (comps._total) return data;
    const total = {};
    for (const dk of Object.keys(comps)) {
      const entry = comps[dk];
      if (entry && typeof entry === 'object') {
        for (const tid of Object.keys(entry)) {
          if (tid === 'uuid' || tid === 'lastModified' || tid === 'isDeleted' || tid === '_table' || tid === 'date') continue;
          const v = entry[tid];
          const delta = typeof v === 'number' ? v : (v ? 1 : 0);
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
