/**
 * db.js - Local IndexedDB 数据层 (offline-first)
 * 使用 localForage 将完整数据缓存到 IndexedDB
 * 依赖: localforage (CDN, 在 index.html 中先于本文件加载)
 */

function ensureSyncFields(item) {
  if (!item || typeof item !== 'object') return item;
  if (!item.uuid) {
    try {
      item.uuid = crypto.randomUUID();
    } catch (e) {
      item.uuid = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
  }
  item.lastModified = new Date().toISOString();
  if (item.isDeleted === undefined) {
    item.isDeleted = false;
  }
  return item;
}

function _ensureAllSyncFields(data) {
  if (!data || typeof data !== 'object') return;

  var flatArrays = ['shopItems', 'redemptions', 'rewardBox', 'activeBuffs', 'bountyTasks', 'badges'];
  for (var i = 0; i < flatArrays.length; i++) {
    var key = flatArrays[i];
    if (Array.isArray(data[key])) {
      data[key].forEach(ensureSyncFields);
    }
  }

  if (data.points && Array.isArray(data.points.history)) {
    data.points.history.forEach(ensureSyncFields);
  }
  if (data.points) {
    ensureSyncFields(data.points);
  }

  var dateArrays = ['homeworks', 'freeTimeTasks', 'bountySubmissions'];
  for (var j = 0; j < dateArrays.length; j++) {
    var dk1 = dateArrays[j];
    if (data[dk1] && typeof data[dk1] === 'object') {
      var dateKeys1 = Object.keys(data[dk1]);
      for (var k = 0; k < dateKeys1.length; k++) {
        var d = dateKeys1[k];
        if (Array.isArray(data[dk1][d])) {
          data[dk1][d].forEach(ensureSyncFields);
        }
      }
    }
  }

  var dateObjects = ['dailySettlement', 'efficiencyHistory', 'bountyCompletions'];
  for (var m = 0; m < dateObjects.length; m++) {
    var dk2 = dateObjects[m];
    if (data[dk2] && typeof data[dk2] === 'object') {
      var dateKeys2 = Object.keys(data[dk2]);
      for (var n = 0; n < dateKeys2.length; n++) {
        var d2 = dateKeys2[n];
        if (data[dk2][d2] && typeof data[dk2][d2] === 'object') {
          ensureSyncFields(data[dk2][d2]);
        }
      }
    }
  }

  if (data.settings && typeof data.settings === 'object') {
    ensureSyncFields(data.settings);
  }
}

var DB = {
  _store: null,
  _data: null,

  _init: function () {
    this._store = localforage.createInstance({ name: 'papacheck_data' });
  },

  _load: async function () {
    if (this._data) return this._data;
    var stored = await this._store.getItem('fullData');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      this._data = stored;
    } else {
      this._data = {};
    }
    return this._data;
  },

  _save: async function () {
    await this._store.setItem('fullData', this._data);
  },

  getFullData: async function () {
    return await this._load();
  },

  getCachedData: function () {
    return this._data;
  },

  cacheFullData: async function (fullData) {
    _ensureAllSyncFields(fullData);
    this._data = fullData;
    await this._save();
  },

  getHomeworks: async function (dateKey) {
    var data = await this._load();
    return data.homeworks ? (data.homeworks[dateKey] || []) : [];
  },

  saveHomeworks: async function (dateKey, list) {
    var data = await this._load();
    if (!data.homeworks) data.homeworks = {};
    if (list && list.length > 0) {
      list.forEach(ensureSyncFields);
    }
    data.homeworks[dateKey] = list;
    // 只更新内存，不写 IndexedDB（只读缓存模式）
  },

  getFreeTime: async function (dateKey) {
    var data = await this._load();
    return data.freeTimeTasks ? (data.freeTimeTasks[dateKey] || []) : [];
  },

  saveFreeTime: async function (dateKey, list) {
    var data = await this._load();
    if (!data.freeTimeTasks) data.freeTimeTasks = {};
    if (list && list.length > 0) {
      list.forEach(ensureSyncFields);
    }
    data.freeTimeTasks[dateKey] = list;
  },

  getSettlement: async function (dateKey) {
    var data = await this._load();
    return data.dailySettlement ? (data.dailySettlement[dateKey] || null) : null;
  },

  saveSettlement: async function (dateKey, settlementData) {
    var data = await this._load();
    if (!data.dailySettlement) data.dailySettlement = {};
    if (settlementData) {
      ensureSyncFields(settlementData);
    }
    data.dailySettlement[dateKey] = settlementData;
  },

  getShopItems: async function () {
    var data = await this._load();
    return data.shopItems || [];
  },

  saveShopItems: async function (items) {
    var data = await this._load();
    if (items && items.length > 0) {
      items.forEach(ensureSyncFields);
    }
    data.shopItems = items;
  },

  getRedemptions: async function () {
    var data = await this._load();
    return data.redemptions || [];
  },

  saveRedemptions: async function (items) {
    var data = await this._load();
    if (items && items.length > 0) {
      items.forEach(ensureSyncFields);
    }
    data.redemptions = items;
  },

  getRewardBox: async function () {
    var data = await this._load();
    return data.rewardBox || [];
  },

  saveRewardBox: async function (items) {
    var data = await this._load();
    if (items && items.length > 0) {
      items.forEach(ensureSyncFields);
    }
    data.rewardBox = items;
  },

  getSettings: async function () {
    var data = await this._load();
    return data.settings || {};
  },

  saveSettings: async function (settings) {
    var data = await this._load();
    if (settings) {
      ensureSyncFields(settings);
    }
    data.settings = settings;
  },

  getActiveBuffs: async function () {
    var data = await this._load();
    return data.activeBuffs || [];
  },

  saveActiveBuffs: async function (buffs) {
    var data = await this._load();
    if (buffs && buffs.length > 0) {
      buffs.forEach(ensureSyncFields);
    }
    data.activeBuffs = buffs;
  },

  getBountyTasks: async function () {
    var data = await this._load();
    return data.bountyTasks || [];
  },

  saveBountyTasks: async function (items) {
    var data = await this._load();
    if (items && items.length > 0) {
      items.forEach(ensureSyncFields);
    }
    data.bountyTasks = items;
  },

  getBountySubmissions: async function (dateKey) {
    var data = await this._load();
    return data.bountySubmissions ? (data.bountySubmissions[dateKey] || []) : [];
  },

  saveBountySubmissions: async function (dateKey, list) {
    var data = await this._load();
    if (!data.bountySubmissions) data.bountySubmissions = {};
    var currentList = data.bountySubmissions[dateKey];
    if ((!currentList || currentList.length === 0) && typeof cachedData !== 'undefined' && cachedData && cachedData.bountySubmissions && cachedData.bountySubmissions[dateKey]) {
      data.bountySubmissions[dateKey] = JSON.parse(JSON.stringify(cachedData.bountySubmissions[dateKey]));
    }
    if (list && list.length > 0) {
      list.forEach(ensureSyncFields);
    }
    data.bountySubmissions[dateKey] = list;
  },

  getBountyCompletions: async function (dateKey) {
    var data = await this._load();
    return data.bountyCompletions ? (data.bountyCompletions[dateKey] || {}) : {};
  },

  saveBountyCompletions: async function (dateKey, completionData) {
    var data = await this._load();
    if (!data.bountyCompletions) data.bountyCompletions = {};
    if (Array.isArray(completionData)) {
      completionData = completionData[0] || {};
    }
    if (completionData) {
      if (!completionData.uuid) {
        try {
          completionData.uuid = crypto.randomUUID();
        } catch (e) {
          completionData.uuid = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        }
      }
    }
    data.bountyCompletions[dateKey] = completionData;
  },

  getEfficiency: async function (dateKey) {
    var data = await this._load();
    return data.efficiencyHistory ? (data.efficiencyHistory[dateKey] || null) : null;
  },

  saveEfficiency: async function (dateKey, efficiencyData) {
    var data = await this._load();
    if (!data.efficiencyHistory) data.efficiencyHistory = {};
    if (efficiencyData) {
      ensureSyncFields(efficiencyData);
    }
    data.efficiencyHistory[dateKey] = efficiencyData;
  },

  getPoints: async function () {
    var data = await this._load();
    return data.points || { balance: 0, history: [] };
  },

  savePoints: async function (pointsData) {
    var data = await this._load();
    if (pointsData) {
      if (pointsData.history && pointsData.history.length > 0) {
        pointsData.history.forEach(ensureSyncFields);
      }
      ensureSyncFields(pointsData);
    }
    data.points = pointsData;
  },
};

DB._init();
