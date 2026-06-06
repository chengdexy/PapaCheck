import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CRDTOperation } from '../crdt/types.js';

// ==================== Types ====================

export interface PointsHistoryEntry {
  id?: number;
  date: string;
  earned: number;
  spent: number;
  balance: number;
  detail: string;
}

export interface FullDataSnapshot {
  points: { balance: number; history: PointsHistoryEntry[] };
  badges: any[];
  history: Record<string, any>;
  tasks: Record<string, any>;
  homeworks: Record<string, any[]>;
  dailySettlement: Record<string, any>;
  shopItems: any[];
  redemptions: any[];
  rewardBox: any[];
  settings: any;
  activeBuffs: any[];
  efficiencyHistory: Record<string, any>;
  freeTimeTasks: Record<string, any[]>;
  bountyTasks: any[];
  bountySubmissions: Record<string, any[]>;
  bountyCompletions: Record<string, any>;
}

export interface ModifiedEntry {
  table_name: string;
  record_key: string;
  data?: any;
  last_modified: string;
}

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

// ==================== Database Class ====================

export class PapaCheckDB {
  private db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this._initSchema();
  }

  // ==================== Schema Init ====================

  private _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS points (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        balance INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS points_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 插入默认行
    this.db.prepare(
      "INSERT OR IGNORE INTO points (id, balance) VALUES (1, 0)"
    ).run();

    const singleRowDefaults = [
      { table: 'shop_items', data: '[]' },
      { table: 'redemptions', data: '[]' },
      { table: 'badges', data: '[]' },
      { table: 'reward_box', data: '[]' },
      { table: 'settings', data: '{}' },
      { table: 'active_buffs', data: '[]' },
      { table: 'bounty_tasks', data: '[]' },
      { table: 'email_config', data: '{}' },
    ];

    // 每张表单独准备语句
    for (const { table, data } of singleRowDefaults) {
      this.db.prepare(
        `INSERT OR IGNORE INTO ${table} (id, data) VALUES (1, ?)`
      ).run(data);
    }
  }

  // ==================== Internal Helpers ====================

  private _safeJsonParse(data: string): any | undefined {
    try {
      const val = JSON.parse(data);
      return val !== null && val !== undefined ? val : undefined;
    } catch {
      return undefined;
    }
  }

  private _getJson(table: string, idValue: number = 1): any {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(idValue) as { data: string } | undefined;
    return row ? this._safeJsonParse(row.data) ?? null : null;
  }

  private _setJson(table: string, data: any, idValue: number = 1): void {
    this.db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(
      JSON.stringify(data),
      idValue
    );
  }

  private _getDateDataRaw(table: string, dateKey: string): any {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE date_key = ?`).get(dateKey) as { data: string } | undefined;
    return row ? this._safeJsonParse(row.data) : undefined;
  }

  private _getDateData(table: string, dateKey: string, defaultVal: any = null): any {
    const data = this._getDateDataRaw(table, dateKey);
    if (data === undefined) return defaultVal;
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  private _setDateData(table: string, dateKey: string, data: any): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO ${table} (date_key, data) VALUES (?, ?)`
    ).run(dateKey, JSON.stringify(data));
  }

  private _filterDeleted(data: any): any {
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  private _resetDailyShopQuantity(): void {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'last_shop_reset'").get() as { value: string } | undefined;
    const lastReset = row ? row.value : '';

    if (lastReset !== today) {
      const itemsRow = this.db.prepare("SELECT data FROM shop_items WHERE id = 1").get() as { data: string };
      if (!itemsRow) return;
      const items = this._safeJsonParse(itemsRow.data);
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (item && typeof item === 'object' && item._originalDailyLimit !== undefined) {
          item.dailyLimit = item._originalDailyLimit;
          delete item._originalDailyLimit;
        }
        if (item && typeof item === 'object' && item.dailyLimit !== undefined && typeof item.dailySold === 'number') {
          item.dailySold = 0;
        }
      }
      this._setJson('shop_items', items);
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)").run(today);
    }
  }

  private _findByUuid(items: any[], uuid: string): { index: number; item: any } {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.uuid === uuid || item?.id === uuid || item?.taskId === uuid) {
        return { index: i, item };
      }
    }
    return { index: -1, item: null };
  }

  /** 在数组中按 id/uuid/taskId 查找（通用方法） */
  _findInArray(data: any[], id: string): { index: number; item: any } {
    return this._findByUuid(data, id);
  }

  /** 在 date_key 表中按 id 查找记录（跨所有 date_key 搜索） */
  _findRecordById(table: string, id: string): { dateKey: string; index: number; item: any } | null {
    const rows = this.db.prepare(`SELECT date_key, data FROM ${table}`).all() as { date_key: string; data: string }[];
    for (const row of rows) {
      const data = JSON.parse(row.data);
      if (Array.isArray(data)) {
        const { index, item } = this._findInArray(data, id);
        if (item) return { dateKey: row.date_key, index, item };
      }
    }
    return null;
  }

  private _classifyChange(data: any): string | null {
    if (data._table) return data._table;
    if (data.subject) return 'homeworks';
    if (data.dailyBase && data.rating !== undefined) return 'daily_settlement';
    if (data.cost !== undefined || data.baseQuantity !== undefined) return 'shop_items';
    if (data.itemId && data.status !== undefined) return 'redemptions';
    if (data.itemName && data.status !== undefined) return 'redemptions';
    if (data.quantity !== undefined && data.name) return 'reward_box';
    if (data.dailyBasePoints !== undefined || data.ratingMultipliers !== undefined) return 'settings';
    if (data.duration !== undefined && data.unit) return 'active_buffs';
    if (data.name && data.durationMinutes !== undefined) return 'free_time_tasks';
    if (data.balance !== undefined) return 'points';
    if (data.createdAt && data.points !== undefined) return 'bounty_tasks';
    if (data.startedAt) return 'bounty_submissions';
    if (data.taskId) return 'bounty_completions';
    if (data.averageRatio !== undefined || data.efficiencyRatio !== undefined) return 'efficiency_history';
    return null;
  }

  // ==================== Full Data ====================

  getFullData(): FullDataSnapshot {
    this._resetDailyShopQuantity();

    const pointsRow = this.db.prepare("SELECT balance FROM points WHERE id = 1").get() as { balance: number };
    const historyRows = this.db.prepare("SELECT * FROM points_history ORDER BY id ASC").all() as PointsHistoryEntry[];

    const data: FullDataSnapshot = {
      points: {
        balance: pointsRow.balance,
        history: historyRows,
      },
      badges: this._getJson('badges') ?? [],
      history: {},
      tasks: {},
      homeworks: {},
      dailySettlement: {},
      shopItems: this._filterDeleted(this._getJson('shop_items')) ?? [],
      redemptions: this._filterDeleted(this._getJson('redemptions')) ?? [],
      rewardBox: this._filterDeleted(this._getJson('reward_box')) ?? [],
      settings: this._getJson('settings') ?? {},
      activeBuffs: this._filterDeleted(this._getJson('active_buffs')) ?? [],
      efficiencyHistory: {},
      freeTimeTasks: {},
      bountyTasks: this._filterDeleted(this._getJson('bounty_tasks')) ?? [],
      bountySubmissions: {},
      bountyCompletions: {},
    };

    // homeworks
    const hwRows = this.db.prepare("SELECT date_key, data FROM homeworks").all() as { date_key: string; data: string }[];
    for (const row of hwRows) {
      const items = this._safeJsonParse(row.data);
      if (Array.isArray(items)) {
        data.homeworks[row.date_key] = items.filter((h: any) => !h.isDeleted);
      }
    }

    // dailySettlement
    const dsRows = this.db.prepare("SELECT date_key, data FROM daily_settlement").all() as { date_key: string; data: string }[];
    for (const row of dsRows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.dailySettlement[row.date_key] = val;
      }
    }

    // efficiencyHistory
    const ehRows = this.db.prepare("SELECT date_key, data FROM efficiency_history").all() as { date_key: string; data: string }[];
    for (const row of ehRows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.efficiencyHistory[row.date_key] = val;
      }
    }

    // freeTimeTasks
    const ftRows = this.db.prepare("SELECT date_key, data FROM free_time_tasks").all() as { date_key: string; data: string }[];
    for (const row of ftRows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.freeTimeTasks[row.date_key] = this._filterDeleted(val);
      }
    }

    // bountySubmissions
    const bsRows = this.db.prepare("SELECT date_key, data FROM bounty_submissions").all() as { date_key: string; data: string }[];
    for (const row of bsRows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.bountySubmissions[row.date_key] = this._filterDeleted(val);
      }
    }

    // bountyCompletions
    const bcRows = this.db.prepare("SELECT date_key, data FROM bounty_completions").all() as { date_key: string; data: string }[];
    for (const row of bcRows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.bountyCompletions[row.date_key] = val;
      }
    }

    return data;
  }

  importFullData(data: any): void {
    const points = data.points ?? {};
    const balance = typeof points === 'number' ? points : (points.balance ?? 0);
    this.db.prepare("UPDATE points SET balance = ? WHERE id = 1").run(balance);

    // 清空并重新插入 points_history
    this.db.prepare("DELETE FROM points_history").run();
    const history = (typeof points === 'object' && points.history) ? points.history : [];
    const insertHistory = this.db.prepare(
      "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?)"
    );
    for (const h of history) {
      insertHistory.run(h.date ?? '', h.earned ?? 0, h.spent ?? 0, h.balance ?? 0, h.detail ?? '');
    }

    this._setJson('badges', data.badges ?? []);

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
      const delStmt = this.db.prepare(`DELETE FROM ${table}`);
      delStmt.run();
      const insertStmt = this.db.prepare(
        `INSERT OR REPLACE INTO ${table} (date_key, data) VALUES (?, ?)`
      );
      for (const [dk, v] of Object.entries(source)) {
        insertStmt.run(dk, JSON.stringify(v));
      }
    }

    // 单行表
    this._setJson('shop_items', data.shopItems ?? []);
    this._setJson('redemptions', data.redemptions ?? []);
    this._setJson('reward_box', data.rewardBox ?? []);
    this._setJson('settings', data.settings ?? {});
    this._setJson('active_buffs', data.activeBuffs ?? []);
    this._setJson('bounty_tasks', data.bountyTasks ?? []);
  }

  // ==================== Points ====================

  getPointsBalance(): number {
    const row = this.db.prepare("SELECT balance FROM points WHERE id = 1").get() as { balance: number };
    return row.balance;
  }

  updatePoints(action: 'earn' | 'spend', amount: number, detail: string): number {
    const row = this.db.prepare("SELECT balance FROM points WHERE id = 1").get() as { balance: number };
    let balance = row.balance;

    if (action === 'spend') {
      balance -= amount;
    } else {
      balance += amount;
    }

    this.db.prepare("UPDATE points SET balance = ? WHERE id = 1").run(balance);

    const today = new Date().toISOString().slice(0, 10);
    this.db.prepare(
      "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?)"
    ).run(
      today,
      action === 'earn' ? amount : 0,
      action === 'spend' ? amount : 0,
      balance,
      detail
    );

    return balance;
  }

  patchPoints(delta: { earn?: number; spend?: number; detail?: string }): number {
    const row = this.db.prepare("SELECT balance FROM points WHERE id = 1").get() as { balance: number };
    let balance = row.balance;

    const earned = delta.earn ?? 0;
    const spent = delta.spend ?? 0;
    balance += earned - spent;

    this.db.prepare("UPDATE points SET balance = ? WHERE id = 1").run(balance);

    const today = new Date().toISOString().slice(0, 10);
    this.db.prepare(
      "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES (?, ?, ?, ?, ?)"
    ).run(today, earned, spent, balance, delta.detail ?? '');

    this.recordModification('points', '1', new Date().toISOString());

    return balance;
  }

  // ==================== Homeworks ====================

  getHomeworks(dateKey: string): any[] {
    return this._getDateData('homeworks', dateKey, []);
  }

  saveHomeworks(dateKey: string, items: any[]): void {
    this._setDateData('homeworks', dateKey, items);
    this.recordModification('homeworks', dateKey, new Date().toISOString());
  }

  moveHomework(fromDate: string, toDate: string, hwId: string): any | null {
    const fromList = this._getDateData('homeworks', fromDate, null);
    if (!fromList) return null;

    const idx = fromList.findIndex((h: any) => h.id === hwId);
    if (idx === -1) return null;

    const [hw] = fromList.splice(idx, 1);
    this._setDateData('homeworks', fromDate, fromList);

    const toList = this._getDateData('homeworks', toDate, []);
    toList.push(hw);
    this._setDateData('homeworks', toDate, toList);

    const now = new Date().toISOString();
    this.recordModification('homeworks', fromDate, now);
    this.recordModification('homeworks', toDate, now);

    return hw;
  }

  getHomeworkById(id: string): any | null {
    const found = this._findRecordById('homeworks', id);
    return found?.item && !found.item.isDeleted ? found.item : null;
  }

  putHomework(id: string, data: any): void {
    const existing = this._findRecordById('homeworks', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = this._getDateDataRaw('homeworks', existing.dateKey);
      if (!Array.isArray(items)) {
        // 数据损坏：覆盖为新数组
        this._setDateData('homeworks', existing.dateKey, [data]);
        this.recordModification('homeworks', existing.dateKey, now);
        return;
      }
      items[existing.index] = data;
      this._setDateData('homeworks', existing.dateKey, items);
      this.recordModification('homeworks', existing.dateKey, now);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      let items = this._getDateDataRaw('homeworks', dateKey);
      if (!Array.isArray(items)) {
        items = [];
      }
      items.push(data);
      this._setDateData('homeworks', dateKey, items);
      this.recordModification('homeworks', dateKey, now);
    }
  }

  patchHomework(id: string, fields: any): void {
    const existing = this._findRecordById('homeworks', id);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = this._getDateDataRaw('homeworks', existing.dateKey);
    items[existing.index] = { ...items[existing.index], ...fields, lastModified: now };
    this._setDateData('homeworks', existing.dateKey, items);
    this.recordModification('homeworks', existing.dateKey, now);
  }

  deleteHomework(id: string): void {
    const existing = this._findRecordById('homeworks', id);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = this._getDateDataRaw('homeworks', existing.dateKey);
    items[existing.index].isDeleted = true;
    items[existing.index].lastModified = now;
    this._setDateData('homeworks', existing.dateKey, items);
    this.recordModification('homeworks', existing.dateKey, now);
  }

  // ==================== Settlement ====================

  getSettlement(dateKey: string): any {
    return this._getDateData('daily_settlement', dateKey);
  }

  saveSettlement(dateKey: string, data: any): void {
    this._setDateData('daily_settlement', dateKey, data);
    this.recordModification('daily_settlement', dateKey, new Date().toISOString());
  }

  putSettlement(dateKey: string, data: any): void {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setDateData('daily_settlement', dateKey, data);
    this.recordModification('daily_settlement', dateKey, now);
  }

  patchSettlement(dateKey: string, fields: any): void {
    const existing = this._getDateDataRaw('daily_settlement', dateKey) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    this._setDateData('daily_settlement', dateKey, merged);
    this.recordModification('daily_settlement', dateKey, now);
  }

  // ==================== Shop ====================

  getShopItems(): any[] {
    this._resetDailyShopQuantity();
    return this._getJson('shop_items') ?? [];
  }

  saveShopItems(items: any[]): void {
    this._setJson('shop_items', items);
    this.recordModification('shop_items', '1', new Date().toISOString());
  }

  getShopItemById(id: string): any | null {
    const items = this._getJson('shop_items') ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  putShopItem(id: string, data: any): void {
    const items = this._getJson('shop_items') ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    this._setJson('shop_items', items);
    this.recordModification('shop_items', '1', now);
  }

  deleteShopItem(id: string): void {
    const items = this._getJson('shop_items') ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    this._setJson('shop_items', items);
    this.recordModification('shop_items', '1', now);
  }

  // ==================== Redemptions ====================

  getRedemptions(): any[] {
    return this._getJson('redemptions') ?? [];
  }

  saveRedemptions(items: any[]): void {
    this._setJson('redemptions', items);
    this.recordModification('redemptions', '1', new Date().toISOString());
  }

  putRedemption(id: string, data: any): void {
    const items = this._getJson('redemptions') ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    this._setJson('redemptions', items);
    this.recordModification('redemptions', '1', now);
  }

  // ==================== Reward Box ====================

  getRewardBox(): any[] {
    return this._getJson('reward_box') ?? [];
  }

  saveRewardBox(items: any[]): void {
    this._setJson('reward_box', items);
    this.recordModification('reward_box', '1', new Date().toISOString());
  }

  putRewardBoxItem(id: string, data: any): void {
    const items = this._getJson('reward_box') ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    this._setJson('reward_box', items);
    this.recordModification('reward_box', '1', now);
  }

  // ==================== Settings ====================

  getSettings(): any {
    return this._getJson('settings') ?? {};
  }

  saveSettings(data: any): void {
    this._setJson('settings', data);
    this.recordModification('settings', '1', new Date().toISOString());
  }

  putSettings(data: any): void {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setJson('settings', data);
    this.recordModification('settings', '1', now);
  }

  patchSettings(fields: any): void {
    const existing = this._getJson('settings') ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    this._setJson('settings', merged);
    this.recordModification('settings', '1', now);
  }

  // ==================== Active Buffs ====================

  getActiveBuffs(): any[] {
    return this._getJson('active_buffs') ?? [];
  }

  saveActiveBuffs(items: any[]): void {
    this._setJson('active_buffs', items);
    this.recordModification('active_buffs', '1', new Date().toISOString());
  }

  putBuff(id: string, data: any): void {
    const items = this._getJson('active_buffs') ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    this._setJson('active_buffs', items);
    this.recordModification('active_buffs', '1', now);
  }

  deleteBuff(id: string): void {
    const items = this._getJson('active_buffs') ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    this._setJson('active_buffs', items);
    this.recordModification('active_buffs', '1', now);
  }

  // ==================== Efficiency ====================

  getEfficiency(dateKey: string): any {
    return this._getDateData('efficiency_history', dateKey);
  }

  saveEfficiency(dateKey: string, data: any): void {
    this._setDateData('efficiency_history', dateKey, data);
    this.recordModification('efficiency_history', dateKey, new Date().toISOString());
  }

  putEfficiency(dateKey: string, data: any): void {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setDateData('efficiency_history', dateKey, data);
    this.recordModification('efficiency_history', dateKey, now);
  }

  // ==================== Free Time ====================

  getFreeTime(dateKey: string): any[] {
    return this._getDateData('free_time_tasks', dateKey, []);
  }

  saveFreeTime(dateKey: string, tasks: any[]): void {
    this._setDateData('free_time_tasks', dateKey, tasks);
    this.recordModification('free_time_tasks', dateKey, new Date().toISOString());
  }

  putFreeTimeTask(id: string, data: any): void {
    const existing = this._findRecordById('free_time_tasks', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = this._getDateDataRaw('free_time_tasks', existing.dateKey);
      items[existing.index] = data;
      this._setDateData('free_time_tasks', existing.dateKey, items);
      this.recordModification('free_time_tasks', existing.dateKey, now);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      const items = this._getDateDataRaw('free_time_tasks', dateKey) ?? [];
      items.push(data);
      this._setDateData('free_time_tasks', dateKey, items);
      this.recordModification('free_time_tasks', dateKey, now);
    }
  }

  // ==================== Bounty Tasks ====================

  getBountyTasks(): any[] {
    return this._getJson('bounty_tasks') ?? [];
  }

  saveBountyTasks(items: any[]): void {
    this._setJson('bounty_tasks', items);
    this.recordModification('bounty_tasks', '1', new Date().toISOString());
  }

  getBountyTaskById(id: string): any | null {
    const items = this._getJson('bounty_tasks') ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  putBountyTask(id: string, data: any): void {
    const items = this._getJson('bounty_tasks') ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    this._setJson('bounty_tasks', items);
    this.recordModification('bounty_tasks', '1', now);
  }

  deleteBountyTask(id: string): void {
    const items = this._getJson('bounty_tasks') ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    this._setJson('bounty_tasks', items);
    this.recordModification('bounty_tasks', '1', now);
  }

  // ==================== Bounty Submissions ====================

  getBountySubmissions(dateKey: string): any[] {
    return this._getDateData('bounty_submissions', dateKey, []);
  }

  saveBountySubmissions(dateKey: string, data: any[]): void {
    this._setDateData('bounty_submissions', dateKey, data);
    this.recordModification('bounty_submissions', dateKey, new Date().toISOString());
  }

  putBountySubmission(id: string, data: any): void {
    const existing = this._findRecordById('bounty_submissions', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = this._getDateDataRaw('bounty_submissions', existing.dateKey);
      items[existing.index] = data;
      this._setDateData('bounty_submissions', existing.dateKey, items);
      this.recordModification('bounty_submissions', existing.dateKey, now);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      const items = this._getDateDataRaw('bounty_submissions', dateKey) ?? [];
      items.push(data);
      this._setDateData('bounty_submissions', dateKey, items);
      this.recordModification('bounty_submissions', dateKey, now);
    }
  }

  // ==================== Bounty Completions ====================

  getBountyCompletions(dateKey: string): any {
    return this._getDateData('bounty_completions', dateKey, {});
  }

  saveBountyCompletions(dateKey: string, data: any): void {
    this._setDateData('bounty_completions', dateKey, data);
    this.recordModification('bounty_completions', dateKey, new Date().toISOString());
  }

  putBountyCompletion(id: string, data: any): void {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setDateData('bounty_completions', id, data);
    this.recordModification('bounty_completions', id, now);
  }

  // ==================== Email Config ====================

  getEmailConfig(): any | null {
    const data = this._getJson('email_config');
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return data;
    }
    return null;
  }

  saveEmailConfig(config: any): void {
    this._setJson('email_config', config);
    this.recordModification('email_config', '1', new Date().toISOString());
  }

  // ==================== Sync ====================

  getModifiedSince(timestamp: string): ModifiedEntry[] {
    const rows = this.db.prepare(
      "SELECT table_name, record_key, last_modified FROM last_modified WHERE last_modified > ?"
    ).all(timestamp) as { table_name: string; record_key: string; last_modified: string }[];

    const result: ModifiedEntry[] = [];

    for (const row of rows) {
      const table = row.table_name;
      const recordKey = row.record_key;

      if (table === 'points') {
        const pointsRow = this.db.prepare("SELECT balance FROM points WHERE id = 1").get() as { balance: number } | undefined;
        if (pointsRow) {
          result.push({
            table_name: table,
            record_key: recordKey,
            data: { balance: pointsRow.balance },
            last_modified: row.last_modified,
          });
        }
        continue;
      }

      let data: any;
      if (DATE_KEY_TABLES.has(table)) {
        data = this._getDateData(table, recordKey);
      } else if (SINGLE_ROW_TABLES.has(table)) {
        data = this._getJson(table, parseInt(recordKey, 10));
      } else {
        continue;
      }

      result.push({
        table_name: table,
        record_key: recordKey,
        data,
        last_modified: row.last_modified,
      });
    }

    return result;
  }

  pushMerge(changes: any[]): { ok: boolean } {
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
        this.db.prepare("UPDATE points SET balance = ? WHERE id = 1").run(newBalance);
        this.recordModification('points', '1', timestamp);
        continue;
      }

      if (DATE_KEY_TABLES.has(table)) {
        const recordKey = data.date ?? '';
        if (!recordKey) continue;

        const existing = this._getDateDataRaw(table, recordKey);
        let existingList: any[] = Array.isArray(existing) ? [...existing] : [];
        let existingDict = !Array.isArray(existing) ? (existing ?? {}) : null;

        if (Array.isArray(existing)) {
          const { index: idx, item: existingItem } = this._findByUuid(existingList, uuid);
          let foundIdx = idx;
          let foundItem = existingItem;

          // Try alternate ID fields
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

          this._setDateData(table, recordKey, existingList);
          this.recordModification(table, recordKey, timestamp);
        } else if (existingDict !== null) {
          const oldLast = existingDict.lastModified ?? '0';
          if (changeType === 'delete') {
            data.isDeleted = true;
            this._setDateData(table, recordKey, data);
          } else if (newLastModified >= oldLast) {
            this._setDateData(table, recordKey, data);
          }
          this.recordModification(table, recordKey, timestamp);
        }
      } else if (SINGLE_ROW_TABLES.has(table)) {
        const existing = this._getJson(table, 1);
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

          this._setJson(table, existingList, 1);
          this.recordModification(table, '1', timestamp);
        } else if (existingDict !== null) {
          const oldLast = existingDict.lastModified ?? '0';
          if (changeType === 'delete') {
            data.isDeleted = true;
            this._setJson(table, data, 1);
          } else if (newLastModified >= oldLast) {
            this._setJson(table, data, 1);
          }
          this.recordModification(table, '1', timestamp);
        }
      }
    }

    return { ok: true };
  }

  recordModification(tableName: string, recordKey: string, timestamp: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO last_modified (table_name, record_key, last_modified) VALUES (?, ?, ?)"
    ).run(tableName, recordKey, timestamp);
  }

  // ==================== Misc ====================

  resetDate(dateKey: string): void {
    this.db.prepare("DELETE FROM homeworks WHERE date_key = ?").run(dateKey);
    this.db.prepare("DELETE FROM daily_settlement WHERE date_key = ?").run(dateKey);
    this.db.prepare("DELETE FROM efficiency_history WHERE date_key = ?").run(dateKey);
    this.db.prepare("DELETE FROM free_time_tasks WHERE date_key = ?").run(dateKey);
    this.db.prepare("DELETE FROM bounty_submissions WHERE date_key = ?").run(dateKey);
    this.db.prepare("DELETE FROM bounty_completions WHERE date_key = ?").run(dateKey);

    // 清理与当日相关的 active_buffs
    const buffs = this._getJson('active_buffs') ?? [];
    const beforeCount = buffs.length;
    const parts = dateKey.split('-');
    const isoPrefix = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    const filteredBuffs = buffs.filter((b: any) =>
      b.startDate !== dateKey && !b.startDate?.startsWith(isoPrefix)
    );
    if (filteredBuffs.length !== beforeCount) {
      this._setJson('active_buffs', filteredBuffs);
    }

    this.db.prepare("DELETE FROM meta WHERE key = 'last_shop_reset'").run();
  }

  // ==================== CRDT Operations ====================

  saveCRDTOperation(op: CRDTOperation): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO crdt_operations (id, type, table_name, resource_id, field, value, timestamp, node_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(op.id, op.type, op.table, op.resourceId, op.field, JSON.stringify(op.value), op.timestamp, op.nodeId);
  }

  getCRDTOperationsSince(timestamp: string): CRDTOperation[] {
    const rows = this.db.prepare(
      "SELECT * FROM crdt_operations WHERE timestamp > ? ORDER BY timestamp ASC"
    ).all(timestamp) as any[];
    return rows.map(row => ({
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

  ackCRDTOperations(timestamp: string): void {
    this.db.prepare("DELETE FROM crdt_operations WHERE timestamp <= ?").run(timestamp);
  }

  // ==================== Connection ====================

  close(): void {
    this.db.close();
  }
}

export { PapaCheckDB as Database };
