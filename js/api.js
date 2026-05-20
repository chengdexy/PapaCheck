/**
 * api.js - 数据层
 * 负责与后端 API 通信，服务端 data.json 为唯一数据源
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
    const result = await this._fetch('/api/data');
    isServerMode = true;
    cachedData = result;
    return result;
  },

  async getTasks(dateKey) {
    return await this._fetch(`/api/tasks/${dateKey}`);
  },

  async saveTasks(dateKey, taskList) {
    await this._fetch(`/api/tasks/${dateKey}`, {
      method: 'POST',
      body: JSON.stringify({ tasks: taskList }),
    });
    return true;
  },

  async getHomeworks(dateKey) {
    return await this._fetch(`/api/homeworks/${dateKey}`);
  },

  async saveHomeworks(dateKey, list) {
    await this._fetch(`/api/homeworks/${dateKey}`, {
      method: 'POST',
      body: JSON.stringify({ homeworks: list }),
    });
    return true;
  },

  async getSettlement(dateKey) {
    return await this._fetch(`/api/settlement/${dateKey}`);
  },

  async saveSettlement(dateKey, settlementData) {
    await this._fetch(`/api/settlement/${dateKey}`, {
      method: 'POST',
      body: JSON.stringify({ settlement: settlementData }),
    });
    return true;
  },

  async updatePoints(action, amount, detail) {
    const result = await this._fetch('/api/points', {
      method: 'POST',
      body: JSON.stringify({ action, amount, detail }),
    });
    return result.balance;
  },

  async getRedemptions() {
    return await this._fetch('/api/redemptions');
  },

  async saveRedemptions(list) {
    await this._fetch('/api/redemptions', {
      method: 'POST',
      body: JSON.stringify({ redemptions: list }),
    });
    return true;
  },

  async getRewardBox() {
    return await this._fetch('/api/reward-box');
  },

  async saveRewardBox(items) {
    await this._fetch('/api/reward-box', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    return true;
  },

  async getSettings() {
    return await this._fetch('/api/settings');
  },

  async saveSettings(settings) {
    await this._fetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings }),
    });
    return true;
  },

  async getShopItems() {
    return await this._fetch('/api/shop');
  },

  async saveShopItems(items) {
    await this._fetch('/api/shop', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    return true;
  },

  async getEfficiency(dateKey) {
    return await this._fetch(`/api/efficiency/${dateKey}`);
  },

  async saveEfficiency(dateKey, efficiencyData) {
    await this._fetch(`/api/efficiency/${dateKey}`, {
      method: 'POST',
      body: JSON.stringify({ efficiency: efficiencyData }),
    });
    return true;
  },

  async getFreeTime(dateKey) {
    return await this._fetch(`/api/freetime/${dateKey}`);
  },

  async saveFreeTime(dateKey, tasks) {
    await this._fetch(`/api/freetime/${dateKey}`, {
      method: 'POST',
      body: JSON.stringify({ tasks }),
    });
    return true;
  },
};
