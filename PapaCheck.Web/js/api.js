/**
 * api.js - 数据层（支持离线优先）
 * 在线时通过后端 API 通信，离线时通过 localForage + IndexedDB 读写本地数据
 * 离线数据通过 sync.js 在上线后自动同步
 */

let isServerMode = false;
let cachedData = null;

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
        const localData = await DB.getFullData();
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
    try {
      return await this._fetch(`/api/tasks/${dateKey}`);
    } catch (e) {
      try {
        var data = await DB.getFullData();
        var key = dateKey;
        return (data.homeworks && data.homeworks[key]) ? data.homeworks[key] : [];
      } catch (dbErr) {
        throw e;
      }
    }
  },

  async getHomeworks(dateKey) {
    try {
      return await this._fetch(`/api/homeworks/${dateKey}`);
    } catch (e) {
      return await DB.getHomeworks(dateKey);
    }
  },

  async saveHomeworks(dateKey, list) {
    if (isServerMode) {
      try {
        await this._fetch(`/api/homeworks/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ homeworks: list }),
        });
        try { await DB.saveHomeworks(dateKey, list); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveHomeworks(dateKey, list);
    return true;
  },

  async getSettlement(dateKey) {
    try {
      return await this._fetch(`/api/settlement/${dateKey}`);
    } catch (e) {
      return await DB.getSettlement(dateKey);
    }
  },

  async saveSettlement(dateKey, settlementData) {
    if (isServerMode) {
      try {
        await this._fetch(`/api/settlement/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ settlement: settlementData }),
        });
        try { await DB.saveSettlement(dateKey, settlementData); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveSettlement(dateKey, settlementData);
    return true;
  },

  async updatePoints(action, amount, detail) {
    if (isServerMode) {
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
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
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
    try {
      return await this._fetch('/api/redemptions');
    } catch (e) {
      return await DB.getRedemptions();
    }
  },

  async saveRedemptions(list) {
    if (isServerMode) {
      try {
        await this._fetch('/api/redemptions', {
          method: 'POST',
          body: JSON.stringify({ redemptions: list }),
        });
        try { await DB.saveRedemptions(list); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveRedemptions(list);
    return true;
  },

  async getRewardBox() {
    try {
      return await this._fetch('/api/reward-box');
    } catch (e) {
      return await DB.getRewardBox();
    }
  },

  async saveRewardBox(items) {
    if (isServerMode) {
      try {
        await this._fetch('/api/reward-box', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
        try { await DB.saveRewardBox(items); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveRewardBox(items);
    return true;
  },

  async getSettings() {
    try {
      return await this._fetch('/api/settings');
    } catch (e) {
      return await DB.getSettings();
    }
  },

  async saveSettings(settings) {
    if (isServerMode) {
      try {
        await this._fetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ settings }),
        });
        try { await DB.saveSettings(settings); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveSettings(settings);
    return true;
  },

  async getActiveBuffs() {
    try {
      return await this._fetch('/api/active-buffs');
    } catch (e) {
      return await DB.getActiveBuffs();
    }
  },

  async saveActiveBuffs(buffs) {
    if (isServerMode) {
      try {
        await this._fetch('/api/active-buffs', {
          method: 'POST',
          body: JSON.stringify({ buffs }),
        });
        try { await DB.saveActiveBuffs(buffs); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveActiveBuffs(buffs);
    return true;
  },

  async getShopItems() {
    try {
      return await this._fetch('/api/shop');
    } catch (e) {
      return await DB.getShopItems();
    }
  },

  async saveShopItems(items) {
    if (isServerMode) {
      try {
        await this._fetch('/api/shop', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
        try { await DB.saveShopItems(items); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveShopItems(items);
    return true;
  },

  async getEfficiency(dateKey) {
    try {
      return await this._fetch(`/api/efficiency/${dateKey}`);
    } catch (e) {
      return await DB.getEfficiency(dateKey);
    }
  },

  async saveEfficiency(dateKey, efficiencyData) {
    if (isServerMode) {
      try {
        await this._fetch(`/api/efficiency/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ efficiency: efficiencyData }),
        });
        try { await DB.saveEfficiency(dateKey, efficiencyData); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveEfficiency(dateKey, efficiencyData);
    return true;
  },

  async getFreeTime(dateKey) {
    try {
      return await this._fetch(`/api/freetime/${dateKey}`);
    } catch (e) {
      return await DB.getFreeTime(dateKey);
    }
  },

  async saveFreeTime(dateKey, tasks) {
    if (isServerMode) {
      try {
        await this._fetch(`/api/freetime/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ tasks }),
        });
        try { await DB.saveFreeTime(dateKey, tasks); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveFreeTime(dateKey, tasks);
    return true;
  },

  async deferHomework(dateKey, hwId, action, requestedAt) {
    if (isServerMode) {
      try {
        return await this._fetch('/api/defer-homework', {
          method: 'POST',
          body: JSON.stringify({ date: dateKey, hwId, action, requestedAt }),
        });
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
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
    try {
      return await this._fetch('/api/bounty-tasks');
    } catch (e) {
      return await DB.getBountyTasks();
    }
  },

  async saveBountyTasks(items) {
    if (isServerMode) {
      try {
        await this._fetch('/api/bounty-tasks', {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
        try { await DB.saveBountyTasks(items); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveBountyTasks(items);
    return true;
  },

  async getBountySubmissions(dateKey) {
    try {
      return await this._fetch(`/api/bounty-submissions/${dateKey}`);
    } catch (e) {
      return await DB.getBountySubmissions(dateKey);
    }
  },

  async saveBountySubmissions(dateKey, submissions) {
    if (isServerMode) {
      try {
        await this._fetch(`/api/bounty-submissions/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ submissions }),
        });
        try { await DB.saveBountySubmissions(dateKey, submissions); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveBountySubmissions(dateKey, submissions);
    return true;
  },

  async getBountyCompletions(dateKey) {
    try {
      return await this._fetch(`/api/bounty-completions/${dateKey}`);
    } catch (e) {
      return await DB.getBountyCompletions(dateKey);
    }
  },

  async saveBountyCompletions(dateKey, completions) {
    if (isServerMode) {
      try {
        await this._fetch(`/api/bounty-completions/${dateKey}`, {
          method: 'POST',
          body: JSON.stringify({ completions }),
        });
        try { await DB.saveBountyCompletions(dateKey, completions); } catch (e) { }
        return true;
      } catch (e) {
        isServerMode = false;
        updateConnStatus();
      }
    }
    await DB.saveBountyCompletions(dateKey, completions);
    return true;
  },

  async resetDate(date) {
    if (!isServerMode) {
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
