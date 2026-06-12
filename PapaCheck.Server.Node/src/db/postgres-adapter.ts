import crypto from 'node:crypto';
import { Pool } from 'pg';
import type { Pool as PoolType, QueryResult } from 'pg';
import { DatabaseAdapter } from './adapter.js';
import type { FullDataSnapshot, PointsHistoryEntry, ModifiedEntry, NotificationItem } from './types.js';
import type { CRDTOperation } from '../crdt/types.js';

/** date_key 表：以日期为主键，存储 JSON 数据 */
const DATE_KEY_TABLES = new Set([
  'homeworks',
  'daily_settlement',
  'efficiency_history',
  'free_time_tasks',
  'bounty_submissions',
  'bounty_completions',
]);

/** 单行表：id=1，data 列为 JSON */
const SINGLE_ROW_TABLES = new Set([
  'shop_items',
  'redemptions',
  'reward_box',
  'settings',
  'active_buffs',
  'bounty_tasks',
  'badges',
  'points',
  'email_config',
]);

// ==================== PostgresAdapter ====================

export class PostgresAdapter extends DatabaseAdapter {
  private pool: PoolType;

  constructor(connectionString: string) {
    super();
    this.pool = new Pool({ connectionString });
    this._initSchema();
  }

  // ==================== Schema Init ====================

  private async _initSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS points (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        balance INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS points_history (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        earned INTEGER NOT NULL DEFAULT 0,
        spent INTEGER NOT NULL DEFAULT 0,
        balance INTEGER NOT NULL DEFAULT 0,
        detail TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS homeworks (
        date_key TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS daily_settlement (
        date_key TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS redemptions (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS efficiency_history (
        date_key TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS free_time_tasks (
        date_key TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS reward_box (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS active_buffs (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS bounty_tasks (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS email_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS bounty_submissions (
        date_key TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS bounty_completions (
        date_key TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS last_modified (
        table_name TEXT NOT NULL,
        record_key TEXT NOT NULL,
        last_modified TEXT NOT NULL,
        PRIMARY KEY (table_name, record_key)
      );

      CREATE TABLE IF NOT EXISTS crdt_operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        table_name TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        field TEXT,
        value TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        node_id TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // 插入默认行
    await this.pool.query(
      "INSERT INTO points (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING"
    );

    const singleRowDefaults: Array<{ table: string; data: string }> = [
      { table: 'shop_items', data: '[]' },
      { table: 'redemptions', data: '[]' },
      { table: 'badges', data: '[]' },
      { table: 'reward_box', data: '[]' },
      { table: 'settings', data: '{}' },
      { table: 'active_buffs', data: '[]' },
      { table: 'bounty_tasks', data: '[]' },
      { table: 'email_config', data: '{}' },
    ];

    for (const { table, data } of singleRowDefaults) {
      await this.pool.query(
        `INSERT INTO ${table} (id, data) VALUES (1, $1) ON CONFLICT DO NOTHING`,
        [data]
      );
    }
  }

  // ==================== Internal Helpers ====================

  private async _getJson(table: string, idValue: number = 1): Promise<any> {
    const result = await this.pool.query(
      `SELECT data FROM ${table} WHERE id = $1`,
      [idValue]
    );
    if (result.rows.length === 0) return null;
    return this._safeJsonParse(result.rows[0].data) ?? null;
  }

  private async _setJson(table: string, data: any, idValue: number = 1): Promise<void> {
    await this.pool.query(
      `UPDATE ${table} SET data = $1 WHERE id = $2`,
      [JSON.stringify(data), idValue]
    );
  }

  private async _getDateDataRaw(table: string, dateKey: string): Promise<any> {
    const result = await this.pool.query(
      `SELECT data FROM ${table} WHERE date_key = $1`,
      [dateKey]
    );
    if (result.rows.length === 0) return undefined;
    return this._safeJsonParse(result.rows[0].data);
  }

  private async _getDateData(table: string, dateKey: string, defaultVal: any = null): Promise<any> {
    const data = await this._getDateDataRaw(table, dateKey);
    if (data === undefined) return defaultVal;
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  private async _setDateData(table: string, dateKey: string, data: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${table} (date_key, data) VALUES ($1, $2) ON CONFLICT (date_key) DO UPDATE SET data = $2`,
      [dateKey, JSON.stringify(data)]
    );
  }

  private async _resetDailyShopQuantity(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await this.pool.query(
      "SELECT value FROM meta WHERE key = 'last_shop_reset'"
    );
    const lastReset = result.rows.length > 0 ? result.rows[0].value : '';

    if (lastReset !== today) {
      const itemsResult = await this.pool.query(
        "SELECT data FROM shop_items WHERE id = 1"
      );
      if (itemsResult.rows.length === 0) return;
      const items = this._safeJsonParse(itemsResult.rows[0].data);
      if (!Array.isArray(items)) return;
      const now = new Date().toISOString();
      for (const item of items) {
        if (item && typeof item === 'object') {
          if (item._originalDailyLimit !== undefined) {
            item.dailyLimit = item._originalDailyLimit;
            delete item._originalDailyLimit;
          }
          if (item.dailyLimit !== undefined && typeof item.dailySold === 'number') {
            item.dailySold = 0;
          }
          if (typeof item.baseQuantity === 'number' && typeof item.remainingQuantity === 'number') {
            item.remainingQuantity = item.baseQuantity;
            item.lastModified = now;
          }
        }
      }
      await this._setJson('shop_items', items);
      await this.pool.query(
        "INSERT INTO meta (key, value) VALUES ('last_shop_reset', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [today]
      );
    }
  }

  /** 在 date_key 表中按 id 查找记录（跨所有 date_key 搜索） */
  async _findRecordById(table: string, id: string): Promise<{ dateKey: string; index: number; item: any } | null> {
    const result = await this.pool.query(
      `SELECT date_key, data FROM ${table}`
    );
    for (const row of result.rows) {
      const data = this._safeJsonParse(row.data);
      if (!data) continue;
      if (Array.isArray(data)) {
        const { index, item } = this._findInArray(data, id);
        if (item) return { dateKey: row.date_key, index, item };
      }
    }
    return null;
  }

  // ==================== Full Data ====================

  async getFullData(): Promise<FullDataSnapshot> {
    await this._resetDailyShopQuantity();

    const pointsResult = await this.pool.query(
      "SELECT balance FROM points WHERE id = 1"
    );
    const historyResult = await this.pool.query(
      "SELECT * FROM points_history ORDER BY id ASC"
    );

    const data: FullDataSnapshot = {
      points: {
        balance: pointsResult.rows[0]?.balance ?? 0,
        history: historyResult.rows as PointsHistoryEntry[],
      },
      badges: (await this._getJson('badges')) ?? [],
      history: {},
      tasks: {},
      homeworks: {},
      dailySettlement: {},
      shopItems: this._filterDeleted((await this._getJson('shop_items'))) ?? [],
      redemptions: this._filterDeleted((await this._getJson('redemptions'))) ?? [],
      rewardBox: this._filterDeleted((await this._getJson('reward_box'))) ?? [],
      settings: (await this._getJson('settings')) ?? {},
      activeBuffs: this._filterDeleted((await this._getJson('active_buffs'))) ?? [],
      efficiencyHistory: {},
      freeTimeTasks: {},
      bountyTasks: this._filterDeleted((await this._getJson('bounty_tasks'))) ?? [],
      bountySubmissions: {},
      bountyCompletions: {},
    };

    // homeworks
    const hwResult = await this.pool.query("SELECT date_key, data FROM homeworks");
    for (const row of hwResult.rows) {
      const items = this._safeJsonParse(row.data);
      if (Array.isArray(items)) {
        data.homeworks[row.date_key] = items.filter((h: any) => !h.isDeleted);
      }
    }

    // dailySettlement
    const dsResult = await this.pool.query("SELECT date_key, data FROM daily_settlement");
    for (const row of dsResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.dailySettlement[row.date_key] = val;
      }
    }

    // efficiencyHistory
    const ehResult = await this.pool.query("SELECT date_key, data FROM efficiency_history");
    for (const row of ehResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.efficiencyHistory[row.date_key] = val;
      }
    }

    // freeTimeTasks
    const ftResult = await this.pool.query("SELECT date_key, data FROM free_time_tasks");
    for (const row of ftResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.freeTimeTasks[row.date_key] = this._filterDeleted(val);
      }
    }

    // bountySubmissions
    const bsResult = await this.pool.query("SELECT date_key, data FROM bounty_submissions");
    for (const row of bsResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.bountySubmissions[row.date_key] = this._filterDeleted(val);
      }
    }

    // bountyCompletions
    const bcResult = await this.pool.query("SELECT date_key, data FROM bounty_completions");
    for (const row of bcResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.bountyCompletions[row.date_key] = val;
      }
    }

    return data;
  }

  async importFullData(data: any): Promise<void> {
    const points = data.points ?? {};
    const balance = typeof points === 'number' ? points : (points.balance ?? 0);
    await this.pool.query("UPDATE points SET balance = $1 WHERE id = 1", [balance]);

    // 清空并重新插入 points_history
    await this.pool.query("DELETE FROM points_history");
    const history = (typeof points === 'object' && points.history) ? points.history : [];
    for (const h of history) {
      await this.pool.query(
        "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)",
        [h.date ?? '', h.earned ?? 0, h.spent ?? 0, h.balance ?? 0, h.detail ?? '']
      );
    }

    await this._setJson('badges', data.badges ?? []);

    // date_key 表
    const dateKeySetters: Array<{ table: string; sourceKey: string; defaultValue: any }> = [
      { table: 'homeworks', sourceKey: 'homeworks', defaultValue: {} },
      { table: 'daily_settlement', sourceKey: 'dailySettlement', defaultValue: {} },
      { table: 'efficiency_history', sourceKey: 'efficiencyHistory', defaultValue: {} },
      { table: 'free_time_tasks', sourceKey: 'freeTimeTasks', defaultValue: {} },
      { table: 'bounty_submissions', sourceKey: 'bountySubmissions', defaultValue: {} },
      { table: 'bounty_completions', sourceKey: 'bountyCompletions', defaultValue: {} },
    ];

    for (const { table, sourceKey, defaultValue } of dateKeySetters) {
      const source = data[sourceKey] ?? defaultValue;
      await this.pool.query(`DELETE FROM ${table}`);
      for (const [dk, v] of Object.entries(source)) {
        await this.pool.query(
          `INSERT INTO ${table} (date_key, data) VALUES ($1, $2) ON CONFLICT (date_key) DO UPDATE SET data = $2`,
          [dk, JSON.stringify(v)]
        );
      }
    }

    // 单行表
    await this._setJson('shop_items', data.shopItems ?? []);
    await this._setJson('redemptions', data.redemptions ?? []);
    await this._setJson('reward_box', data.rewardBox ?? []);
    await this._setJson('settings', data.settings ?? {});
    await this._setJson('active_buffs', data.activeBuffs ?? []);
    await this._setJson('bounty_tasks', data.bountyTasks ?? []);
  }

  // ==================== Notifications ====================

  async addNotification(text: string, createdAt?: number): Promise<string> {
    const id = crypto.randomUUID();
    const now = createdAt ?? Date.now();
    await this.pool.query(
      'INSERT INTO notifications (id, text, created_at) VALUES ($1, $2, $3)',
      [id, text, now]
    );
    return id;
  }

  async getPendingNotifications(): Promise<NotificationItem[]> {
    const cutoff = Date.now() - 3600000;
    // 先清理过期通知
    await this.pool.query('DELETE FROM notifications WHERE created_at < $1', [cutoff]);

    const result = await this.pool.query(
      'SELECT id, text, created_at FROM notifications WHERE created_at >= $1 ORDER BY created_at ASC',
      [cutoff]
    );

    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
    }));
  }

  async consumeNotifications(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const BATCH_SIZE = 500;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
      await this.pool.query(
        `DELETE FROM notifications WHERE id IN (${placeholders})`,
        batch
      );
    }
  }

  // ==================== Points ====================

  async getPointsBalance(): Promise<number> {
    const result = await this.pool.query(
      "SELECT balance FROM points WHERE id = 1"
    );
    return result.rows[0]?.balance ?? 0;
  }

  async updatePoints(action: 'earn' | 'spend', amount: number, detail: string): Promise<number> {
    const result = await this.pool.query(
      "SELECT balance FROM points WHERE id = 1"
    );
    let balance = result.rows[0]?.balance ?? 0;

    if (action === 'spend') {
      balance -= amount;
    } else {
      balance += amount;
    }

    await this.pool.query(
      "UPDATE points SET balance = $1 WHERE id = 1",
      [balance]
    );

    const today = new Date().toISOString().slice(0, 10);
    await this.pool.query(
      "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)",
      [
        today,
        action === 'earn' ? amount : 0,
        action === 'spend' ? amount : 0,
        balance,
        detail,
      ]
    );

    return balance;
  }

  async patchPoints(delta: { earn?: number; spend?: number; detail?: string }): Promise<number> {
    const result = await this.pool.query(
      "SELECT balance FROM points WHERE id = 1"
    );
    let balance = result.rows[0]?.balance ?? 0;

    const earned = delta.earn ?? 0;
    const spent = delta.spend ?? 0;
    balance += earned - spent;

    await this.pool.query(
      "UPDATE points SET balance = $1 WHERE id = 1",
      [balance]
    );

    const today = new Date().toISOString().slice(0, 10);
    await this.pool.query(
      "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)",
      [today, earned, spent, balance, delta.detail ?? '']
    );

    await this.recordModification('points', '1', new Date().toISOString());

    return balance;
  }

  // ==================== Homeworks ====================

  async getHomeworks(dateKey: string): Promise<any[]> {
    return this._getDateData('homeworks', dateKey, []);
  }

  async saveHomeworks(dateKey: string, items: any[]): Promise<void> {
    await this._setDateData('homeworks', dateKey, items);
    await this.recordModification('homeworks', dateKey, new Date().toISOString());
  }

  async moveHomework(fromDate: string, toDate: string, hwId: string): Promise<any | null> {
    const fromList = await this._getDateData('homeworks', fromDate, null);
    if (!fromList) return null;

    const idx = fromList.findIndex((h: any) => h.id === hwId);
    if (idx === -1) return null;

    const [hw] = fromList.splice(idx, 1);
    await this._setDateData('homeworks', fromDate, fromList);

    const toList = await this._getDateData('homeworks', toDate, []);
    toList.push(hw);
    await this._setDateData('homeworks', toDate, toList);

    const now = new Date().toISOString();
    await this.recordModification('homeworks', fromDate, now);
    await this.recordModification('homeworks', toDate, now);

    return hw;
  }

  async getHomeworkById(id: string): Promise<any | null> {
    const found = await this._findRecordById('homeworks', id);
    return found?.item && !found.item.isDeleted ? found.item : null;
  }

  async putHomework(id: string, data: any): Promise<void> {
    const existing = await this._findRecordById('homeworks', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing && !existing.item.isDeleted) {
      const items = await this._getDateDataRaw('homeworks', existing.dateKey);
      if (!Array.isArray(items)) {
        await this._setDateData('homeworks', existing.dateKey, [data]);
        await this.recordModification('homeworks', existing.dateKey, now);
        return;
      }
      items[existing.index] = data;
      await this._setDateData('homeworks', existing.dateKey, items);
      await this.recordModification('homeworks', existing.dateKey, now);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      let items = await this._getDateDataRaw('homeworks', dateKey);
      if (!Array.isArray(items)) {
        items = [];
      }
      items.push(data);
      await this._setDateData('homeworks', dateKey, items);
      await this.recordModification('homeworks', dateKey, now);
    }
  }

  async patchHomework(id: string, fields: any): Promise<void> {
    const existing = await this._findRecordById('homeworks', id);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = await this._getDateDataRaw('homeworks', existing.dateKey);
    items[existing.index] = { ...items[existing.index], ...fields, lastModified: now };
    await this._setDateData('homeworks', existing.dateKey, items);
    await this.recordModification('homeworks', existing.dateKey, now);
  }

  async deleteHomework(id: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = await this._getDateDataRaw('homeworks', existing.dateKey);
    items[existing.index].isDeleted = true;
    items[existing.index].lastModified = now;
    await this._setDateData('homeworks', existing.dateKey, items);
    await this.recordModification('homeworks', existing.dateKey, now);
  }

  // ==================== Settlement ====================

  async getSettlement(dateKey: string): Promise<any> {
    return this._getDateData('daily_settlement', dateKey);
  }

  async saveSettlement(dateKey: string, data: any): Promise<void> {
    await this._setDateData('daily_settlement', dateKey, data);
    await this.recordModification('daily_settlement', dateKey, new Date().toISOString());
  }

  async putSettlement(dateKey: string, data: any): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('daily_settlement', dateKey, data);
    await this.recordModification('daily_settlement', dateKey, now);
  }

  async patchSettlement(dateKey: string, fields: any): Promise<void> {
    const existing = (await this._getDateDataRaw('daily_settlement', dateKey)) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    await this._setDateData('daily_settlement', dateKey, merged);
    await this.recordModification('daily_settlement', dateKey, now);
  }

  // ==================== Shop ====================

  async getShopItems(): Promise<any[]> {
    await this._resetDailyShopQuantity();
    return (await this._getJson('shop_items')) ?? [];
  }

  async saveShopItems(items: any[]): Promise<void> {
    await this._setJson('shop_items', items);
    await this.recordModification('shop_items', '1', new Date().toISOString());
  }

  async getShopItemById(id: string): Promise<any | null> {
    const items = (await this._getJson('shop_items')) ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putShopItem(id: string, data: any): Promise<void> {
    const items = (await this._getJson('shop_items')) ?? [];
    const { index, item: existingItem } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      if (existingItem?.lastModified && data.lastModified < existingItem.lastModified) {
        data.baseQuantity = existingItem.baseQuantity;
        data.remainingQuantity = existingItem.remainingQuantity;
      }
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('shop_items', items);
    await this.recordModification('shop_items', '1', now);
  }

  async deleteShopItem(id: string): Promise<void> {
    const items = (await this._getJson('shop_items')) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('shop_items', items);
    await this.recordModification('shop_items', '1', now);
  }

  // ==================== Redemptions ====================

  async getRedemptions(): Promise<any[]> {
    return (await this._getJson('redemptions')) ?? [];
  }

  async saveRedemptions(items: any[]): Promise<void> {
    await this._setJson('redemptions', items);
    await this.recordModification('redemptions', '1', new Date().toISOString());
  }

  async clearFulfilledRedemptions(): Promise<void> {
    const items = (await this._getJson('redemptions')) ?? [];
    const remaining = items.filter((r: any) => r.status !== 'fulfilled');
    await this._setJson('redemptions', remaining);
    await this.recordModification('redemptions', '1', new Date().toISOString());
  }

  async putRedemption(id: string, data: any): Promise<void> {
    const items = (await this._getJson('redemptions')) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('redemptions', items);
    await this.recordModification('redemptions', '1', now);
  }

  // ==================== Reward Box ====================

  async getRewardBox(): Promise<any[]> {
    return this._filterDeleted((await this._getJson('reward_box'))) ?? [];
  }

  async saveRewardBox(items: any[]): Promise<void> {
    await this._setJson('reward_box', items);
    await this.recordModification('reward_box', '1', new Date().toISOString());
  }

  async putRewardBoxItem(id: string, data: any): Promise<void> {
    const items = (await this._getJson('reward_box')) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('reward_box', items);
    await this.recordModification('reward_box', '1', now);
  }

  async deleteRewardBoxItem(id: string): Promise<void> {
    const items = (await this._getJson('reward_box')) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('reward_box', items);
    await this.recordModification('reward_box', '1', now);
  }

  // ==================== Settings ====================

  async getSettings(): Promise<any> {
    return (await this._getJson('settings')) ?? {};
  }

  async saveSettings(data: any): Promise<void> {
    await this._setJson('settings', data);
    await this.recordModification('settings', '1', new Date().toISOString());
  }

  async putSettings(data: any): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setJson('settings', data);
    await this.recordModification('settings', '1', now);
  }

  async patchSettings(fields: any): Promise<void> {
    const existing = (await this._getJson('settings')) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    await this._setJson('settings', merged);
    await this.recordModification('settings', '1', now);
  }

  // ==================== Active Buffs ====================

  async getActiveBuffs(): Promise<any[]> {
    return (await this._getJson('active_buffs')) ?? [];
  }

  async saveActiveBuffs(items: any[]): Promise<void> {
    await this._setJson('active_buffs', items);
    await this.recordModification('active_buffs', '1', new Date().toISOString());
  }

  async putBuff(id: string, data: any): Promise<void> {
    const items = (await this._getJson('active_buffs')) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('active_buffs', items);
    await this.recordModification('active_buffs', '1', now);
  }

  async deleteBuff(id: string): Promise<void> {
    const items = (await this._getJson('active_buffs')) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('active_buffs', items);
    await this.recordModification('active_buffs', '1', now);
  }

  // ==================== Efficiency ====================

  async getEfficiency(dateKey: string): Promise<any> {
    return this._getDateData('efficiency_history', dateKey);
  }

  async saveEfficiency(dateKey: string, data: any): Promise<void> {
    await this._setDateData('efficiency_history', dateKey, data);
    await this.recordModification('efficiency_history', dateKey, new Date().toISOString());
  }

  async putEfficiency(dateKey: string, data: any): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('efficiency_history', dateKey, data);
    await this.recordModification('efficiency_history', dateKey, now);
  }

  // ==================== Free Time ====================

  async getFreeTime(dateKey: string): Promise<any[]> {
    return this._getDateData('free_time_tasks', dateKey, []);
  }

  async saveFreeTime(dateKey: string, tasks: any[]): Promise<void> {
    await this._setDateData('free_time_tasks', dateKey, tasks);
    await this.recordModification('free_time_tasks', dateKey, new Date().toISOString());
  }

  async putFreeTimeTask(id: string, data: any): Promise<void> {
    const existing = await this._findRecordById('free_time_tasks', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = await this._getDateDataRaw('free_time_tasks', existing.dateKey);
      items[existing.index] = data;
      await this._setDateData('free_time_tasks', existing.dateKey, items);
      await this.recordModification('free_time_tasks', existing.dateKey, now);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      const items = (await this._getDateDataRaw('free_time_tasks', dateKey)) ?? [];
      items.push(data);
      await this._setDateData('free_time_tasks', dateKey, items);
      await this.recordModification('free_time_tasks', dateKey, now);
    }
  }

  // ==================== Bounty Tasks ====================

  async getBountyTasks(): Promise<any[]> {
    return (await this._getJson('bounty_tasks')) ?? [];
  }

  async saveBountyTasks(items: any[]): Promise<void> {
    await this._setJson('bounty_tasks', items);
    await this.recordModification('bounty_tasks', '1', new Date().toISOString());
  }

  async getBountyTaskById(id: string): Promise<any | null> {
    const items = (await this._getJson('bounty_tasks')) ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putBountyTask(id: string, data: any): Promise<void> {
    const items = (await this._getJson('bounty_tasks')) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('bounty_tasks', items);
    await this.recordModification('bounty_tasks', '1', now);
  }

  async deleteBountyTask(id: string): Promise<void> {
    const items = (await this._getJson('bounty_tasks')) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('bounty_tasks', items);
    await this.recordModification('bounty_tasks', '1', now);
  }

  // ==================== Bounty Submissions ====================

  async getBountySubmissions(dateKey: string): Promise<any[]> {
    return this._getDateData('bounty_submissions', dateKey, []);
  }

  async saveBountySubmissions(dateKey: string, data: any[]): Promise<void> {
    await this._setDateData('bounty_submissions', dateKey, data);
    await this.recordModification('bounty_submissions', dateKey, new Date().toISOString());
  }

  async putBountySubmission(id: string, data: any): Promise<void> {
    const existing = await this._findRecordById('bounty_submissions', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = await this._getDateDataRaw('bounty_submissions', existing.dateKey);
      items[existing.index] = data;
      await this._setDateData('bounty_submissions', existing.dateKey, items);
      await this.recordModification('bounty_submissions', existing.dateKey, now);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      const items = (await this._getDateDataRaw('bounty_submissions', dateKey)) ?? [];
      items.push(data);
      await this._setDateData('bounty_submissions', dateKey, items);
      await this.recordModification('bounty_submissions', dateKey, now);
    }
  }

  // ==================== Bounty Completions ====================

  async getBountyCompletions(dateKey: string): Promise<any> {
    return this._getDateData('bounty_completions', dateKey, {});
  }

  async saveBountyCompletions(dateKey: string, data: any): Promise<void> {
    await this._setDateData('bounty_completions', dateKey, data);
    await this.recordModification('bounty_completions', dateKey, new Date().toISOString());
  }

  async putBountyCompletion(id: string, data: any): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('bounty_completions', id, data);
    await this.recordModification('bounty_completions', id, now);
  }

  // ==================== Email Config ====================

  async getEmailConfig(): Promise<any | null> {
    const data = await this._getJson('email_config');
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return data;
    }
    return null;
  }

  async saveEmailConfig(config: any): Promise<void> {
    await this._setJson('email_config', config);
    await this.recordModification('email_config', '1', new Date().toISOString());
  }

  // ==================== Sync ====================

  async getModifiedSince(timestamp: string): Promise<ModifiedEntry[]> {
    const result = await this.pool.query(
      'SELECT table_name, record_key, last_modified FROM last_modified WHERE last_modified > $1',
      [timestamp]
    );

    const rows: ModifiedEntry[] = [];

    for (const row of result.rows) {
      const table = row.table_name;
      const recordKey = row.record_key;

      if (table === 'points') {
        const pointsResult = await this.pool.query(
          "SELECT balance FROM points WHERE id = 1"
        );
        if (pointsResult.rows.length > 0) {
          rows.push({
            table_name: table,
            record_key: recordKey,
            data: { balance: pointsResult.rows[0].balance },
            last_modified: row.last_modified,
          });
        }
        continue;
      }

      let data: any;
      if (DATE_KEY_TABLES.has(table)) {
        data = await this._getDateData(table, recordKey);
      } else if (SINGLE_ROW_TABLES.has(table)) {
        data = await this._getJson(table, parseInt(recordKey, 10));
      } else {
        continue;
      }

      rows.push({
        table_name: table,
        record_key: recordKey,
        data,
        last_modified: row.last_modified,
      });
    }

    return rows;
  }

  async pushMerge(changes: any[]): Promise<{ ok: boolean }> {
    for (const change of changes) {
      const changeType = change.type as string;
      const uuid = change.uuid as string;
      const data = (change.data ?? {}) as any;
      const timestamp = (change.timestamp ?? '') as string;

      if (typeof data !== 'object' || data === null) continue;

      const newLastModified = data.lastModified ?? timestamp;
      const table = this._classifyChange(data);
      if (table === null) continue;

      if (table === 'points') {
        const newBalance = data.balance ?? 0;
        await this.pool.query("UPDATE points SET balance = $1 WHERE id = 1", [newBalance]);
        await this.recordModification('points', '1', timestamp);
        continue;
      }

      if (DATE_KEY_TABLES.has(table)) {
        const recordKey = data.date || data.dateKey || uuid || '';
        if (!recordKey) continue;

        const existing = await this._getDateDataRaw(table, recordKey);
        let existingList: any[] = Array.isArray(existing) ? [...existing] : [];
        let existingDict = !Array.isArray(existing) ? (existing ?? {}) : null;

        if (Array.isArray(existing)) {
          const { index: idx, item: existingItem } = this._findByUuid(existingList, uuid);
          let foundIdx = idx;
          let foundItem = existingItem;

          if (!foundItem && data.id) {
            const alt = this._findByUuid(existingList, data.id);
            foundIdx = alt.index;
            foundItem = alt.item;
          }
          if (!foundItem && data.taskId) {
            const alt = this._findByUuid(existingList, data.taskId);
            foundIdx = alt.index;
            foundItem = alt.item;
          }

          if (foundItem) {
            const oldLast = foundItem.lastModified ?? '0';
            if (changeType === 'delete') {
              existingList[foundIdx].isDeleted = true;
              existingList[foundIdx].lastModified = newLastModified;
            } else if (newLastModified >= oldLast) {
              existingList[foundIdx] = data;
            }
          } else {
            existingList.push(data);
          }

          await this._setDateData(table, recordKey, existingList);
          await this.recordModification(table, recordKey, timestamp);
        } else if (existingDict !== null) {
          const oldLast = existingDict.lastModified ?? '0';
          if (changeType === 'delete') {
            data.isDeleted = true;
            await this._setDateData(table, recordKey, data);
          } else if (newLastModified >= oldLast) {
            await this._setDateData(table, recordKey, data);
          }
          await this.recordModification(table, recordKey, timestamp);
        }
      } else if (SINGLE_ROW_TABLES.has(table)) {
        const existing = await this._getJson(table, 1);
        const existingList = Array.isArray(existing) ? [...existing] : null;
        const existingDict = !Array.isArray(existing) ? (existing ?? {}) : null;

        if (existingList) {
          const { index: idx, item: existingItem } = this._findByUuid(existingList, uuid);
          let foundIdx = idx;
          let foundItem = existingItem;

          if (!foundItem && data.id) {
            const alt = this._findByUuid(existingList, data.id);
            foundIdx = alt.index;
            foundItem = alt.item;
          }
          if (!foundItem && data.taskId) {
            const alt = this._findByUuid(existingList, data.taskId);
            foundIdx = alt.index;
            foundItem = alt.item;
          }

          if (foundItem) {
            const oldLast = foundItem.lastModified ?? '0';
            if (changeType === 'delete') {
              existingList[foundIdx].isDeleted = true;
              existingList[foundIdx].lastModified = newLastModified;
            } else if (newLastModified >= oldLast) {
              existingList[foundIdx] = data;
            }
          } else {
            existingList.push(data);
          }

          await this._setJson(table, existingList, 1);
          await this.recordModification(table, '1', timestamp);
        } else if (existingDict !== null) {
          const oldLast = existingDict.lastModified ?? '0';
          if (changeType === 'delete') {
            data.isDeleted = true;
            await this._setJson(table, data, 1);
          } else if (newLastModified >= oldLast) {
            await this._setJson(table, data, 1);
          }
          await this.recordModification(table, '1', timestamp);
        }
      }
    }

    return { ok: true };
  }

  async recordModification(tableName: string, recordKey: string, timestamp: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO last_modified (table_name, record_key, last_modified) VALUES ($1, $2, $3) ON CONFLICT (table_name, record_key) DO UPDATE SET last_modified = $3',
      [tableName, recordKey, timestamp]
    );
  }

  // ==================== Misc ====================

  async resetDate(dateKey: string): Promise<void> {
    await this.pool.query("DELETE FROM homeworks WHERE date_key = $1", [dateKey]);
    await this.pool.query("DELETE FROM daily_settlement WHERE date_key = $1", [dateKey]);
    await this.pool.query("DELETE FROM efficiency_history WHERE date_key = $1", [dateKey]);
    await this.pool.query("DELETE FROM free_time_tasks WHERE date_key = $1", [dateKey]);
    await this.pool.query("DELETE FROM bounty_submissions WHERE date_key = $1", [dateKey]);
    await this.pool.query("DELETE FROM bounty_completions WHERE date_key = $1", [dateKey]);

    // 清理与当日相关的 active_buffs
    const buffs = (await this._getJson('active_buffs')) ?? [];
    const beforeCount = buffs.length;
    const parts = dateKey.split('-');
    if (parts.length !== 3) return;
    const isoPrefix = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    const filteredBuffs = buffs.filter((b: any) =>
      b.startDate !== dateKey && !b.startDate?.startsWith(isoPrefix)
    );
    if (filteredBuffs.length !== beforeCount) {
      await this._setJson('active_buffs', filteredBuffs);
    }

    await this.pool.query("DELETE FROM meta WHERE key = 'last_shop_reset'");
  }

  // ==================== CRDT Operations ====================

  async saveCRDTOperation(op: CRDTOperation): Promise<void> {
    await this.pool.query(
      `INSERT INTO crdt_operations (id, type, table_name, resource_id, field, value, timestamp, node_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         type = $2, table_name = $3, resource_id = $4, field = $5,
         value = $6, timestamp = $7, node_id = $8`,
      [op.id, op.type, op.table, op.resourceId, op.field, JSON.stringify(op.value), op.timestamp, op.nodeId]
    );
  }

  async applyCRDTOperation(op: CRDTOperation): Promise<void> {
    try {
      if (op.type === 'delete') {
        switch (op.table) {
          case 'homeworks': await this.deleteHomework(op.resourceId); break;
          case 'shop_items': await this.deleteShopItem(op.resourceId); break;
          case 'active_buffs': await this.deleteBuff(op.resourceId); break;
          case 'bounty_tasks': await this.deleteBountyTask(op.resourceId); break;
          case 'reward_box': await this.deleteRewardBoxItem(op.resourceId); break;
        }
      } else if (op.type === 'update' && op.value) {
        switch (op.table) {
          case 'homeworks': {
            const existingHw = await this._findRecordById('homeworks', op.resourceId);
            if (existingHw) {
              await this.patchHomework(op.resourceId, op.value);
            } else {
              await this.putHomework(op.resourceId, op.value);
            }
            break;
          }
          case 'shop_items': await this.putShopItem(op.resourceId, op.value); break;
          case 'bounty_tasks': await this.putBountyTask(op.resourceId, op.value); break;
          case 'bounty_submissions': await this.putBountySubmission(op.resourceId, op.value); break;
          case 'bounty_completions': await this.putBountyCompletion(op.resourceId, op.value); break;
          case 'redemptions': await this.putRedemption(op.resourceId, op.value); break;
          case 'reward_box': await this.putRewardBoxItem(op.resourceId, op.value); break;
          case 'active_buffs': await this.putBuff(op.resourceId, op.value); break;
          case 'free_time_tasks': await this.putFreeTimeTask(op.resourceId, op.value); break;
          case 'daily_settlement': await this.putSettlement(op.resourceId, op.value); break;
          case 'settings': await this.putSettings(op.value); break;
          case 'notifications':
            await this.addNotification(op.value.text, op.value.createdAt);
            break;
        }
      }
    } catch (e) {
      console.error('Failed to apply CRDT operation', op, e);
    }
  }

  async getCRDTOperationsSince(timestamp: string): Promise<CRDTOperation[]> {
    const result = await this.pool.query(
      'SELECT * FROM crdt_operations WHERE timestamp > $1 ORDER BY timestamp ASC',
      [timestamp]
    );
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      table: row.table_name,
      resourceId: row.resource_id,
      field: row.field,
      value: JSON.parse(row.value),
      timestamp: row.timestamp,
      nodeId: row.node_id,
    }));
  }

  async ackCRDTOperations(timestamp: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM crdt_operations WHERE timestamp <= $1',
      [timestamp]
    );
  }

  // ==================== Connection ====================

  async close(): Promise<void> {
    await this.pool.end();
  }
}
