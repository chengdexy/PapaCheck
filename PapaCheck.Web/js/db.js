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
  if (!item.lastModified) {
    item.lastModified = new Date().toISOString();
  }
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
    await this._save();
    if (list && list.length > 0) {
      for (var i = 0; i < list.length; i++) {
        await ChangeLog.add('update', list[i].uuid, list[i]);
      }
    }
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
    await this._save();
    if (list && list.length > 0) {
      for (var i = 0; i < list.length; i++) {
        await ChangeLog.add('update', list[i].uuid, list[i]);
      }
    }
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
    await this._save();
    if (settlementData) {
      await ChangeLog.add('update', settlementData.uuid, settlementData);
    }
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
    await this._save();
    if (items && items.length > 0) {
      for (var i = 0; i < items.length; i++) {
        await ChangeLog.add('update', items[i].uuid, items[i]);
      }
    }
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
    await this._save();
    if (items && items.length > 0) {
      for (var i = 0; i < items.length; i++) {
        await ChangeLog.add('update', items[i].uuid, items[i]);
      }
    }
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
    await this._save();
    if (items && items.length > 0) {
      for (var i = 0; i < items.length; i++) {
        await ChangeLog.add('update', items[i].uuid, items[i]);
      }
    }
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
    await this._save();
    if (settings) {
      await ChangeLog.add('update', settings.uuid, settings);
    }
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
    await this._save();
    if (buffs && buffs.length > 0) {
      for (var i = 0; i < buffs.length; i++) {
        await ChangeLog.add('update', buffs[i].uuid, buffs[i]);
      }
    }
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
    await this._save();
    if (items && items.length > 0) {
      for (var i = 0; i < items.length; i++) {
        await ChangeLog.add('update', items[i].uuid, items[i]);
      }
    }
  },

  getBountySubmissions: async function (dateKey) {
    var data = await this._load();
    return data.bountySubmissions ? (data.bountySubmissions[dateKey] || []) : [];
  },

  saveBountySubmissions: async function (dateKey, list) {
    var data = await this._load();
    if (!data.bountySubmissions) data.bountySubmissions = {};
    if (list && list.length > 0) {
      list.forEach(ensureSyncFields);
    }
    data.bountySubmissions[dateKey] = list;
    await this._save();
    if (list && list.length > 0) {
      for (var i = 0; i < list.length; i++) {
        await ChangeLog.add('update', list[i].uuid, list[i]);
      }
    }
  },

  getBountyCompletions: async function (dateKey) {
    var data = await this._load();
    return data.bountyCompletions ? (data.bountyCompletions[dateKey] || {}) : {};
  },

  saveBountyCompletions: async function (dateKey, completionData) {
    var data = await this._load();
    if (!data.bountyCompletions) data.bountyCompletions = {};
    if (completionData) {
      ensureSyncFields(completionData);
    }
    data.bountyCompletions[dateKey] = completionData;
    await this._save();
    if (completionData) {
      await ChangeLog.add('update', completionData.uuid, completionData);
    }
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
    await this._save();
    if (efficiencyData) {
      await ChangeLog.add('update', efficiencyData.uuid, efficiencyData);
    }
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
    await this._save();
    if (pointsData) {
      await ChangeLog.add('update', pointsData.uuid, pointsData);
    }
  },
};

DB._init();
