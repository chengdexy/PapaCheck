import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { DatabaseAdapter } from './adapter.js';
import type { FullDataSnapshot, PointsHistoryEntry, ModifiedEntry, NotificationItem, AccessCodeRecord, CreateAccessCodeInput, BackupRecord, HealthRecord, AlertState, OpsConfig } from './types.js';
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

// ==================== SqliteAdapter ====================

export class SqliteAdapter extends DatabaseAdapter {
  private db: DatabaseType;

  constructor(dbPath: string) {
    super();
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

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
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

      -- Multi-tenant auth tables
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        admin_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('parent', 'child', 'admin', 'user')),
        nickname TEXT,
        token_version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        needs_password_change INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        email TEXT,
        password_hash TEXT,
        family_name TEXT,
        first_login INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS access_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('parent', 'child')),
        code_hash TEXT NOT NULL,
        nickname TEXT NOT NULL,
        token_version INTEGER NOT NULL DEFAULT 1,
        access_code TEXT,
        last_login TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS backup_records (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        size_bytes INTEGER,
        status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
        error_message TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        triggered_by TEXT NOT NULL DEFAULT 'scheduler'
      );

      CREATE TABLE IF NOT EXISTS health_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        event_type TEXT NOT NULL CHECK (event_type IN ('alert_triggered', 'alert_recovered')),
        alert_key TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning')),
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        message TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS alert_state (
        alert_key TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'alerting')),
        last_notified_at TEXT,
        first_triggered_at TEXT,
        severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity IN ('critical', 'warning')),
        message TEXT NOT NULL DEFAULT ''
      );
    `);

    // 为已有数据库添加 email/password_hash 列（若不存在则静默失败）
    try { this.db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch { }
    try { this.db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT'); } catch { }

    // 迁移列
    try { this.db.exec('ALTER TABLE users ADD COLUMN family_name TEXT'); } catch { }
    try { this.db.exec('ALTER TABLE users ADD COLUMN first_login INTEGER NOT NULL DEFAULT 0'); } catch { }

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

  private _resetDailyShopQuantity(): void {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'last_shop_reset'").get() as { value: string } | undefined;
    const lastReset = row ? row.value : '';

    if (lastReset !== today) {
      const itemsRow = this.db.prepare("SELECT data FROM shop_items WHERE id = 1").get() as { data: string };
      if (!itemsRow) return;
      const items = this._safeJsonParse(itemsRow.data);
      if (!Array.isArray(items)) return;
      const now = new Date().toISOString();
      for (const item of items) {
        if (item && typeof item === 'object') {
          // 兼容旧版 dailyLimit/dailySold 字段
          if (item._originalDailyLimit !== undefined) {
            item.dailyLimit = item._originalDailyLimit;
            delete item._originalDailyLimit;
          }
          if (item.dailyLimit !== undefined && typeof item.dailySold === 'number') {
            item.dailySold = 0;
          }
          // 重置 baseQuantity/remainingQuantity 模型的每日数量，并更新 lastModified 防止被陈旧 CRDT 操作覆盖
          if (typeof item.baseQuantity === 'number' && typeof item.remainingQuantity === 'number') {
            item.remainingQuantity = item.baseQuantity;
            item.lastModified = now;
          }
        }
      }
      this._setJson('shop_items', items);
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)").run(today);
    }
  }

  /** 在 date_key 表中按 id 查找记录（跨所有 date_key 搜索） */
  _findRecordById(table: string, id: string): { dateKey: string; index: number; item: any } | null {
    const rows = this.db.prepare(`SELECT date_key, data FROM ${table}`).all() as { date_key: string; data: string }[];
    for (const row of rows) {
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

  async getFullData(_tenantId?: string): Promise<FullDataSnapshot> {
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

  async importFullData(data: any, _tenantId?: string): Promise<void> {
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

  // ==================== Notifications ====================

  async addNotification(text: string, createdAt?: number, _tenantId?: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = createdAt ?? Date.now();
    this.db.prepare(
      'INSERT INTO notifications (id, text, created_at) VALUES (?, ?, ?)'
    ).run(id, text, now);
    return id;
  }

  async getPendingNotifications(_tenantId?: string): Promise<NotificationItem[]> {
    const cutoff = Date.now() - 3600000;
    // 先清理过期通知，避免累积
    this.db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff);

    const rows = this.db.prepare(
      'SELECT id, text, created_at FROM notifications WHERE created_at >= ? ORDER BY created_at ASC'
    ).all(cutoff) as any[];

    return rows.map(row => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
    }));
  }

  async consumeNotifications(ids: string[], _tenantId?: string): Promise<void> {
    if (ids.length === 0) return;
    const BATCH_SIZE = 500;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...batch);
    }
  }

  // ==================== Points ====================

  async getPointsBalance(_tenantId?: string): Promise<number> {
    const row = this.db.prepare("SELECT balance FROM points WHERE id = 1").get() as { balance: number };
    return row.balance;
  }

  async updatePoints(action: 'earn' | 'spend', amount: number, detail: string, _tenantId?: string): Promise<number> {
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

  async patchPoints(delta: { earn?: number; spend?: number; detail?: string }, _tenantId?: string): Promise<number> {
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

  async getHomeworks(dateKey: string, _tenantId?: string): Promise<any[]> {
    return this._getDateData('homeworks', dateKey, []);
  }

  async saveHomeworks(dateKey: string, items: any[], _tenantId?: string): Promise<void> {
    this._setDateData('homeworks', dateKey, items);
    this.recordModification('homeworks', dateKey, new Date().toISOString());
  }

  async moveHomework(fromDate: string, toDate: string, hwId: string, _tenantId?: string): Promise<any | null> {
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

  async getHomeworkById(id: string, _tenantId?: string): Promise<any | null> {
    const found = this._findRecordById('homeworks', id);
    return found?.item && !found.item.isDeleted ? found.item : null;
  }

  async putHomework(id: string, data: any, _tenantId?: string): Promise<void> {
    if (typeof data !== 'object' || data === null) return;
    const existing = this._findRecordById('homeworks', id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing && !existing.item.isDeleted) {
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

  async patchHomework(id: string, fields: any, _tenantId?: string): Promise<void> {
    const existing = this._findRecordById('homeworks', id);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = this._getDateDataRaw('homeworks', existing.dateKey);
    items[existing.index] = { ...items[existing.index], ...fields, lastModified: now };
    this._setDateData('homeworks', existing.dateKey, items);
    this.recordModification('homeworks', existing.dateKey, now);
  }

  async deleteHomework(id: string, _tenantId?: string): Promise<void> {
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

  async getSettlement(dateKey: string, _tenantId?: string): Promise<any> {
    return this._getDateData('daily_settlement', dateKey);
  }

  async saveSettlement(dateKey: string, data: any, _tenantId?: string): Promise<void> {
    this._setDateData('daily_settlement', dateKey, data);
    this.recordModification('daily_settlement', dateKey, new Date().toISOString());
  }

  async putSettlement(dateKey: string, data: any, _tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setDateData('daily_settlement', dateKey, data);
    this.recordModification('daily_settlement', dateKey, now);
  }

  async patchSettlement(dateKey: string, fields: any, _tenantId?: string): Promise<void> {
    const existing = this._getDateDataRaw('daily_settlement', dateKey) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    this._setDateData('daily_settlement', dateKey, merged);
    this.recordModification('daily_settlement', dateKey, now);
  }

  // ==================== Shop ====================

  async getShopItems(_tenantId?: string): Promise<any[]> {
    this._resetDailyShopQuantity();
    return this._getJson('shop_items') ?? [];
  }

  async saveShopItems(items: any[], _tenantId?: string): Promise<void> {
    this._setJson('shop_items', items);
    this.recordModification('shop_items', '1', new Date().toISOString());
  }

  async getShopItemById(id: string, _tenantId?: string): Promise<any | null> {
    const items = this._getJson('shop_items') ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putShopItem(id: string, data: any, _tenantId?: string): Promise<void> {
    const items = this._getJson('shop_items') ?? [];
    const { index, item: existingItem } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      // 保护：防止陈旧 CRDT 数据覆盖已重置的每日数量
      // 若 incoming 数据的 lastModified 早于现有数据，且现有数据刚被每日重置，
      // 则保留现有数据的 baseQuantity 和 remainingQuantity
      if (existingItem?.lastModified && data.lastModified < existingItem.lastModified) {
        data.baseQuantity = existingItem.baseQuantity;
        data.remainingQuantity = existingItem.remainingQuantity;
      }
      items[index] = data;
    } else {
      items.push(data);
    }

    this._setJson('shop_items', items);
    this.recordModification('shop_items', '1', now);
  }

  async deleteShopItem(id: string, _tenantId?: string): Promise<void> {
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

  async getRedemptions(_tenantId?: string): Promise<any[]> {
    return this._getJson('redemptions') ?? [];
  }

  async saveRedemptions(items: any[], _tenantId?: string): Promise<void> {
    this._setJson('redemptions', items);
    this.recordModification('redemptions', '1', new Date().toISOString());
  }

  async clearFulfilledRedemptions(_tenantId?: string): Promise<void> {
    const items = this._getJson('redemptions') ?? [];
    const remaining = items.filter((r: any) => r.status !== 'fulfilled');
    this._setJson('redemptions', remaining);
    this.recordModification('redemptions', '1', new Date().toISOString());
  }

  async putRedemption(id: string, data: any, _tenantId?: string): Promise<void> {
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

  async getRewardBox(_tenantId?: string): Promise<any[]> {
    return this._filterDeleted(this._getJson('reward_box')) ?? [];
  }

  async saveRewardBox(items: any[], _tenantId?: string): Promise<void> {
    this._setJson('reward_box', items);
    this.recordModification('reward_box', '1', new Date().toISOString());
  }

  async putRewardBoxItem(id: string, data: any, _tenantId?: string): Promise<void> {
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

  async deleteRewardBoxItem(id: string, _tenantId?: string): Promise<void> {
    const items = this._getJson('reward_box') ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    this._setJson('reward_box', items);
    this.recordModification('reward_box', '1', now);
  }

  // ==================== Settings ====================

  async getSettings(_tenantId?: string): Promise<any> {
    return this._getJson('settings') ?? {};
  }

  async saveSettings(data: any, _tenantId?: string): Promise<void> {
    this._setJson('settings', data);
    this.recordModification('settings', '1', new Date().toISOString());
  }

  async putSettings(data: any, _tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setJson('settings', data);
    this.recordModification('settings', '1', now);
  }

  async patchSettings(fields: any, _tenantId?: string): Promise<void> {
    const existing = this._getJson('settings') ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    this._setJson('settings', merged);
    this.recordModification('settings', '1', now);
  }

  // ==================== Active Buffs ====================

  async getActiveBuffs(_tenantId?: string): Promise<any[]> {
    return this._getJson('active_buffs') ?? [];
  }

  async saveActiveBuffs(items: any[], _tenantId?: string): Promise<void> {
    this._setJson('active_buffs', items);
    this.recordModification('active_buffs', '1', new Date().toISOString());
  }

  async putBuff(id: string, data: any, _tenantId?: string): Promise<void> {
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

  async deleteBuff(id: string, _tenantId?: string): Promise<void> {
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

  async getEfficiency(dateKey: string, _tenantId?: string): Promise<any> {
    return this._getDateData('efficiency_history', dateKey);
  }

  async saveEfficiency(dateKey: string, data: any, _tenantId?: string): Promise<void> {
    this._setDateData('efficiency_history', dateKey, data);
    this.recordModification('efficiency_history', dateKey, new Date().toISOString());
  }

  async putEfficiency(dateKey: string, data: any, _tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setDateData('efficiency_history', dateKey, data);
    this.recordModification('efficiency_history', dateKey, now);
  }

  // ==================== Free Time ====================

  async getFreeTime(dateKey: string, _tenantId?: string): Promise<any[]> {
    return this._getDateData('free_time_tasks', dateKey, []);
  }

  async saveFreeTime(dateKey: string, tasks: any[], _tenantId?: string): Promise<void> {
    this._setDateData('free_time_tasks', dateKey, tasks);
    this.recordModification('free_time_tasks', dateKey, new Date().toISOString());
  }

  async putFreeTimeTask(id: string, data: any, _tenantId?: string): Promise<void> {
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

  async getBountyTasks(_tenantId?: string): Promise<any[]> {
    return this._getJson('bounty_tasks') ?? [];
  }

  async saveBountyTasks(items: any[], _tenantId?: string): Promise<void> {
    this._setJson('bounty_tasks', items);
    this.recordModification('bounty_tasks', '1', new Date().toISOString());
  }

  async getBountyTaskById(id: string, _tenantId?: string): Promise<any | null> {
    const items = this._getJson('bounty_tasks') ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putBountyTask(id: string, data: any, _tenantId?: string): Promise<void> {
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

  async deleteBountyTask(id: string, _tenantId?: string): Promise<void> {
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

  async getBountySubmissions(dateKey: string, _tenantId?: string): Promise<any[]> {
    return this._getDateData('bounty_submissions', dateKey, []);
  }

  async saveBountySubmissions(dateKey: string, data: any[], _tenantId?: string): Promise<void> {
    this._setDateData('bounty_submissions', dateKey, data);
    this.recordModification('bounty_submissions', dateKey, new Date().toISOString());
  }

  async putBountySubmission(id: string, data: any, _tenantId?: string): Promise<void> {
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

  async getBountyCompletions(dateKey: string, _tenantId?: string): Promise<any> {
    return this._getDateData('bounty_completions', dateKey, {});
  }

  async saveBountyCompletions(dateKey: string, data: any, _tenantId?: string): Promise<void> {
    this._setDateData('bounty_completions', dateKey, data);
    this.recordModification('bounty_completions', dateKey, new Date().toISOString());
  }

  async putBountyCompletion(id: string, data: any, _tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    this._setDateData('bounty_completions', id, data);
    this.recordModification('bounty_completions', id, now);
  }

  // ==================== Email Config ====================

  async getEmailConfig(_tenantId?: string): Promise<any | null> {
    const data = this._getJson('email_config');
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return data;
    }
    return null;
  }

  async saveEmailConfig(config: any, _tenantId?: string): Promise<void> {
    this._setJson('email_config', config);
    this.recordModification('email_config', '1', new Date().toISOString());
  }

  // ==================== Sync ====================

  async getModifiedSince(timestamp: string, _tenantId?: string): Promise<ModifiedEntry[]> {
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

  async pushMerge(changes: any[], _tenantId?: string): Promise<{ ok: boolean }> {
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
        const recordKey = data.date || data.dateKey || uuid || '';
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

  async recordModification(tableName: string, recordKey: string, timestamp: string, _tenantId?: string): Promise<void> {
    this.db.prepare(
      "INSERT OR REPLACE INTO last_modified (table_name, record_key, last_modified) VALUES (?, ?, ?)"
    ).run(tableName, recordKey, timestamp);
  }

  // ==================== Misc ====================

  async resetDate(dateKey: string, _tenantId?: string): Promise<void> {
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
    if (parts.length !== 3) return;
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

  async saveCRDTOperation(op: CRDTOperation, _tenantId?: string): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO crdt_operations (id, type, table_name, resource_id, field, value, timestamp, node_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(op.id, op.type, op.table, op.resourceId, op.field, JSON.stringify(op.value), op.timestamp, op.nodeId);
  }

  async applyCRDTOperation(op: CRDTOperation, _tenantId?: string): Promise<void> {
    try {
      if (op.type === 'delete') {
        switch (op.table) {
          case 'homeworks': this.deleteHomework(op.resourceId); break;
          case 'shop_items': this.deleteShopItem(op.resourceId); break;
          case 'active_buffs': this.deleteBuff(op.resourceId); break;
          case 'bounty_tasks': this.deleteBountyTask(op.resourceId); break;
          case 'reward_box': this.deleteRewardBoxItem(op.resourceId); break;
        }
      } else if (op.type === 'update' && op.value) {
        switch (op.table) {
          case 'homeworks': {
            // 新增用 putHomework（创建），已有用 patchHomework（合并）
            const existingHw = this._findRecordById('homeworks', op.resourceId);
            if (existingHw) {
              this.patchHomework(op.resourceId, op.value);
            } else {
              this.putHomework(op.resourceId, op.value);
            }
            break;
          }
          case 'shop_items': this.putShopItem(op.resourceId, op.value); break;
          case 'bounty_tasks': this.putBountyTask(op.resourceId, op.value); break;
          case 'bounty_submissions': this.putBountySubmission(op.resourceId, op.value); break;
          case 'bounty_completions': this.putBountyCompletion(op.resourceId, op.value); break;
          case 'redemptions': this.putRedemption(op.resourceId, op.value); break;
          case 'reward_box': this.putRewardBoxItem(op.resourceId, op.value); break;
          case 'active_buffs': this.putBuff(op.resourceId, op.value); break;
          case 'free_time_tasks': this.putFreeTimeTask(op.resourceId, op.value); break;
          case 'daily_settlement': this.putSettlement(op.resourceId, op.value); break;
          case 'settings': this.putSettings(op.value); break;
          case 'notifications':
            this.addNotification(op.value.text, op.value.createdAt);
            break;
        }
      }
    } catch (e) {
      // 单条操作失败不影响其他操作
      console.error('Failed to apply CRDT operation', op, e);
    }
  }

  async getCRDTOperationsSince(timestamp: string, _tenantId?: string): Promise<CRDTOperation[]> {
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

  async ackCRDTOperations(timestamp: string, _tenantId?: string): Promise<void> {
    this.db.prepare("DELETE FROM crdt_operations WHERE timestamp <= ?").run(timestamp);
  }

  // ==================== Auth ====================

  private async _generateAccessHash(): Promise<{ raw: string; hashed: string }> {
    const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
    let raw = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      raw += chars[bytes[i] % chars.length];
    }
    const hashed = await bcrypt.hash(raw, 10);
    return { raw, hashed };
  }

  async createAccessCode(input: CreateAccessCodeInput): Promise<string> {
    this.db.prepare(
      'INSERT INTO access_codes (id, user_id, type, code_hash, nickname) VALUES (?, ?, ?, ?, ?)'
    ).run(input.id, input.user_id, input.type, input.code_hash, input.nickname);
    return input.id;
  }

  async getAccessCodesByUser(userId: string): Promise<AccessCodeRecord[]> {
    return this.db.prepare(
      'SELECT * FROM access_codes WHERE user_id = ? ORDER BY created_at ASC'
    ).all(userId) as AccessCodeRecord[];
  }

  async findAccessCodeByCode(code: string): Promise<AccessCodeRecord | null> {
    const rows = this.db.prepare('SELECT * FROM access_codes').all() as AccessCodeRecord[];
    for (const row of rows) {
      if (bcrypt.compareSync(code, row.code_hash)) {
        return row;
      }
    }
    return null;
  }

  async getAccessCodeById(id: string): Promise<AccessCodeRecord | null> {
    const row = this.db.prepare('SELECT * FROM access_codes WHERE id = ?').get(id) as AccessCodeRecord | undefined;
    return row ?? null;
  }

  async regenerateAccessCode(id: string, userId: string): Promise<string> {
    const { raw, hashed } = await this._generateAccessHash();
    const result = this.db.prepare(
      'UPDATE access_codes SET code_hash = ?, access_code = ?, token_version = token_version + 1 WHERE id = ? AND user_id = ?'
    ).run(hashed, raw, id, userId);
    if (result.changes === 0) throw new Error('访问码不存在或不属于该用户');
    return raw;
  }

  async deleteAccessCode(id: string, userId: string): Promise<void> {
    this.db.prepare('DELETE FROM access_codes WHERE id = ? AND user_id = ?').run(id, userId);
  }

  async queryUserTokenVersion(userId: string): Promise<number> {
    const row = this.db.prepare("SELECT token_version FROM users WHERE id = ? AND is_active = 1").get(userId) as any;
    return row?.token_version ?? 1;
  }

  async findUserByAccessHash(accessHash: string): Promise<any | null> {
    const rows = this.db.prepare("SELECT * FROM users WHERE is_active = 1").all() as any[];
    for (const row of rows) {
      if (bcrypt.compareSync(accessHash, row.access_hash)) {
        return {
          id: row.id,
          role: row.role,
          nickname: row.nickname,
          token_version: row.token_version,
          is_active: !!row.is_active,
          is_super_admin: !!row.is_super_admin,
          needs_password_change: !!row.needs_password_change,
          created_at: row.created_at,
          email: row.email,
          password_hash: row.password_hash,
          family_name: row.family_name,
          first_login: !!row.first_login,
        };
      }
    }
    return null;
  }

  async findUserByAccessCode(accessCode: string): Promise<any | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE access_code = ? AND is_active = 1 LIMIT 1').get(accessCode) as any;
    if (!row) return null;
    return {
      id: row.id,
      role: row.role,
      nickname: row.nickname,
      token_version: row.token_version,
      is_active: !!row.is_active,
      is_super_admin: !!row.is_super_admin,
      needs_password_change: !!row.needs_password_change,
      created_at: row.created_at,
      email: row.email,
      password_hash: row.password_hash,
      family_name: row.family_name,
      first_login: !!row.first_login,
    };
  }

  async getUserById(userId: string): Promise<any | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!row) return null;
    return {
      id: row.id,
      role: row.role,
      email: row.email,
      password_hash: row.password_hash,
      family_name: row.family_name,
      first_login: !!row.first_login,
      token_version: row.token_version,
      is_active: !!row.is_active,
      is_super_admin: !!row.is_super_admin,
      needs_password_change: !!row.needs_password_change,
      created_at: row.created_at,
    };
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    this.db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
  }

  async updateAccessCodeLastLogin(id: string): Promise<void> {
    this.db.prepare("UPDATE access_codes SET last_login = datetime('now') WHERE id = ?").run(id);
  }

  // ==================== Admin / Members ====================

  async createTenant(id: string, name: string): Promise<void> {
    this.db.prepare(
      'INSERT INTO tenants (id, name) VALUES (?, ?)'
    ).run(id, name);
  }

  async deleteTenant(id: string): Promise<void> {
    this.db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
  }

  async createUser(input: any): Promise<void> {
    const { id, role, email, password_hash, family_name, token_version } = input;
    this.db.prepare(
      'INSERT INTO users (id, role, email, password_hash, family_name, token_version, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(id, role, email ?? null, password_hash ?? null, family_name ?? null, token_version ?? 1);
  }

  async findAdminByEmail(email: string): Promise<any | null> {
    const row = this.db.prepare(
      'SELECT * FROM users WHERE email = ? AND is_active = 1'
    ).get(email) as any;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      password_hash: row.password_hash,
      token_version: row.token_version,
      family_name: row.family_name,
      first_login: !!row.first_login,
      is_super_admin: !!row.is_super_admin,
      needs_password_change: !!row.needs_password_change,
    };
  }

  async findUserByEmail(email: string): Promise<any | null> {
    const row = this.db.prepare(
      'SELECT id, role, email, password_hash, token_version, family_name, first_login, is_active FROM users WHERE email = ? AND is_active = 1 LIMIT 1'
    ).get(email) as any;
    return row || null;
  }

  async getTenantMembers(tenantId: string): Promise<any[]> {
    return this.db.prepare(
      'SELECT id, user_id, type, nickname, created_at FROM access_codes WHERE user_id = ? ORDER BY created_at ASC'
    ).all(tenantId) as any[];
  }

  async updateTenantAdmin(tenantId: string, adminUserId: string): Promise<void> {
    this.db.prepare(
      'UPDATE tenants SET admin_id = ? WHERE id = ?'
    ).run(adminUserId, tenantId);
  }

  async updateTenantName(tenantId: string, newName: string): Promise<void> {
    this.db.prepare(
      'UPDATE tenants SET name = ? WHERE id = ?'
    ).run(newName, tenantId);
  }

  // ==================== Super Admin ====================

  async findSuperAdmin(username: string): Promise<any | null> {
    // 新模型：搜索 users 表中 role='admin' 的行
    const row = this.db.prepare(
      'SELECT id, role, email, password_hash, token_version, first_login FROM users WHERE email = ? AND role = ? AND is_active = 1 LIMIT 1'
    ).get(username, 'admin') as any;
    if (!row) return null;
    return {
      id: row.id,
      tenant_id: row.id,
      email: row.email,
      password_hash: row.password_hash,
      token_version: row.token_version,
      first_login: !!row.first_login,
    };
  }

  async updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<void> {
    this.db.prepare(
      'UPDATE users SET email = ?, password_hash = ?, first_login = 0, token_version = token_version + 1 WHERE id = ?'
    ).run(email, passwordHash, userId);
  }

  async getAllTenants(): Promise<any[]> {
    // SQLite 模式无真实多租户，返回空数组
    return [];
  }

  async setTenantActive(_tenantId: string, _isActive: boolean): Promise<void> {
    // SQLite 模式无操作
  }

  // ==================== Ops Methods ====================

  async insertBackupRecord(record: BackupRecord): Promise<void> {
    this.db.prepare(`INSERT INTO backup_records (id, filename, size_bytes, status, error_message, checksum, created_at, triggered_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.id, record.filename, record.size_bytes, record.status, record.error_message, record.checksum, record.created_at, record.triggered_by
    );
  }

  async listBackupRecords(limit: number): Promise<BackupRecord[]> {
    return this.db.prepare(`SELECT * FROM backup_records ORDER BY created_at DESC LIMIT ?`).all(limit) as BackupRecord[];
  }

  async getBackupRecord(id: string): Promise<BackupRecord | null> {
    return (this.db.prepare(`SELECT * FROM backup_records WHERE id = ?`).get(id) as BackupRecord | null) ?? null;
  }

  async deleteBackupRecord(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM backup_records WHERE id = ?`).run(id);
  }

  async deleteBackupRecordsOlderThan(count: number): Promise<BackupRecord[]> {
    const all = this.db.prepare(`SELECT * FROM backup_records WHERE status = 'success' ORDER BY created_at DESC`).all() as BackupRecord[];
    if (all.length <= count) return [];
    const toDelete = all.slice(count);
    for (const r of toDelete) {
      this.db.prepare(`DELETE FROM backup_records WHERE id = ?`).run(r.id);
    }
    return toDelete;
  }

  async getLatestBackupRecord(): Promise<BackupRecord | null> {
    return (this.db.prepare(`SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 1`).get() as BackupRecord | null) ?? null;
  }

  async insertHealthRecord(record: HealthRecord): Promise<void> {
    this.db.prepare(`INSERT INTO health_records (id, created_at, event_type, alert_key, severity, snapshot_json, message) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      record.id, record.created_at, record.event_type, record.alert_key, record.severity, record.snapshot_json, record.message
    );
  }

  async listHealthRecords(limit: number): Promise<HealthRecord[]> {
    return this.db.prepare(`SELECT * FROM health_records ORDER BY created_at DESC LIMIT ?`).all(limit) as HealthRecord[];
  }

  async pruneHealthRecords(maxRows: number): Promise<void> {
    const count = (this.db.prepare(`SELECT COUNT(*) as c FROM health_records`).get() as { c: number }).c;
    if (count > maxRows) {
      const toDelete = count - maxRows;
      this.db.prepare(`DELETE FROM health_records WHERE id IN (SELECT id FROM health_records ORDER BY created_at ASC LIMIT ?)`).run(toDelete);
    }
  }

  async getAlertState(key: string): Promise<AlertState | null> {
    return (this.db.prepare(`SELECT * FROM alert_state WHERE alert_key = ?`).get(key) as AlertState | null) ?? null;
  }

  async upsertAlertState(state: AlertState): Promise<void> {
    this.db.prepare(`INSERT OR REPLACE INTO alert_state (alert_key, status, last_notified_at, first_triggered_at, severity, message) VALUES (?, ?, ?, ?, ?, ?)`).run(
      state.alert_key, state.status, state.last_notified_at, state.first_triggered_at, state.severity, state.message
    );
  }

  async getOpsConfig(): Promise<OpsConfig | null> {
    const settings = await this.getSettings();
    return settings?.ops_config ?? null;
  }

  async saveOpsConfig(config: OpsConfig): Promise<void> {
    const settings = await this.getSettings();
    settings.ops_config = config;
    await this.saveSettings(settings);
  }

  // ==================== Connection ====================

  async close(): Promise<void> {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // checkpoint 非关键操作，失败不影响关闭
    }
    this.db.close();
  }
}
