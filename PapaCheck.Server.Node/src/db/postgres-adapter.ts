import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { Pool as PoolType, QueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import { DatabaseAdapter } from './adapter.js';
import type { FullDataSnapshot, PointsHistoryEntry, ModifiedEntry, NotificationItem, TenantListItem } from './types.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== PostgresAdapter ====================

export class PostgresAdapter extends DatabaseAdapter {
  pool: PoolType;

  constructor(connectionString: string) {
    super();
    this.pool = new Pool({ connectionString });
    this._initSchema();
  }

  // ==================== Schema Init ====================

  private async _initSchema(): Promise<void> {
    // Read schema from SQL file (which already has tenant_id columns from Task 1)
    const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await this.pool.query(schema);

    // 获取首个已存在的租户 ID（如果表为空则创建一个默认租户）
    const tenantResult = await this.pool.query('SELECT id FROM tenants LIMIT 1');
    let effectiveTenantId: string;
    if (tenantResult.rows.length > 0) {
      effectiveTenantId = tenantResult.rows[0].id;
    } else {
      effectiveTenantId = crypto.randomUUID();
      await this.pool.query(
        `INSERT INTO tenants (id, name) VALUES ($1, '默认租户') ON CONFLICT (id) DO NOTHING`,
        [effectiveTenantId]
      );
    }

    // Insert default rows for each tenant's single-row tables
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
        `INSERT INTO ${table} (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`,
        [effectiveTenantId, data]
      );
    }

    // Insert default points row
    await this.pool.query(
      "INSERT INTO points (tenant_id, id, balance) VALUES ($1, 1, 0) ON CONFLICT DO NOTHING",
      [effectiveTenantId]
    );
  }

  // ==================== Internal Helpers ====================

  private async _getJson(table: string, tenantId?: string, idValue: number = 1): Promise<any> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = `SELECT data FROM ${table} WHERE tenant_id = $1 AND id = $2`;
      params = [tenantId, idValue];
    } else {
      query = `SELECT data FROM ${table} WHERE id = $1`;
      params = [idValue];
    }
    const result = await this.pool.query(query, params);
    if (result.rows.length === 0) return null;
    return this._safeJsonParse(result.rows[0].data) ?? null;
  }

  private async _setJson(table: string, data: any, tenantId?: string, idValue: number = 1): Promise<void> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = `UPDATE ${table} SET data = $1 WHERE tenant_id = $2 AND id = $3`;
      params = [JSON.stringify(data), tenantId, idValue];
    } else {
      query = `UPDATE ${table} SET data = $1 WHERE id = $2`;
      params = [JSON.stringify(data), idValue];
    }
    await this.pool.query(query, params);
  }

  private async _getDateDataRaw(table: string, dateKey: string, tenantId?: string): Promise<any> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = `SELECT data FROM ${table} WHERE tenant_id = $1 AND date_key = $2`;
      params = [tenantId, dateKey];
    } else {
      query = `SELECT data FROM ${table} WHERE date_key = $1`;
      params = [dateKey];
    }
    const result = await this.pool.query(query, params);
    if (result.rows.length === 0) return undefined;
    return this._safeJsonParse(result.rows[0].data);
  }

  private async _getDateData(table: string, dateKey: string, defaultVal: any = null, tenantId?: string): Promise<any> {
    const data = await this._getDateDataRaw(table, dateKey, tenantId);
    if (data === undefined) return defaultVal;
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  private async _setDateData(table: string, dateKey: string, data: any, tenantId?: string): Promise<void> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = `INSERT INTO ${table} (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) DO UPDATE SET data = $3`;
      params = [tenantId, dateKey, JSON.stringify(data)];
    } else {
      query = `INSERT INTO ${table} (date_key, data) VALUES ($1, $2) ON CONFLICT (date_key) DO UPDATE SET data = $2`;
      params = [dateKey, JSON.stringify(data)];
    }
    await this.pool.query(query, params);
  }

  private async _resetDailyShopQuantity(tenantId?: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    let resetQuery: string;
    let resetParams: any[];
    if (tenantId) {
      resetQuery = "SELECT value FROM meta WHERE tenant_id = $1 AND key = 'last_shop_reset'";
      resetParams = [tenantId];
    } else {
      resetQuery = "SELECT value FROM meta WHERE tenant_id IS NULL AND key = 'last_shop_reset'";
      resetParams = [];
    }
    const result = await this.pool.query(resetQuery, resetParams);
    const lastReset = result.rows.length > 0 ? result.rows[0].value : '';

    if (lastReset !== today) {
      const itemsResult = await this._getJson('shop_items', tenantId);
      const items = Array.isArray(itemsResult) ? itemsResult : [];
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
      await this._setJson('shop_items', items, tenantId);

      if (tenantId) {
        await this.pool.query(
          "INSERT INTO meta (tenant_id, key, value) VALUES ($1, 'last_shop_reset', $2) ON CONFLICT (tenant_id, key) DO UPDATE SET value = $2",
          [tenantId, today]
        );
      } else {
        // 无 tenantId 时（SQLite 兼容模式），使用 NULL 标识
        await this.pool.query("DELETE FROM meta WHERE tenant_id IS NULL AND key = 'last_shop_reset'");
        await this.pool.query(
          "INSERT INTO meta (tenant_id, key, value) VALUES (NULL, 'last_shop_reset', $1)",
          [today]
        );
      }
    }
  }

  /** 在 date_key 表中按 id 查找记录（跨所有 date_key 搜索） */
  async _findRecordById(table: string, id: string, tenantId?: string): Promise<{ dateKey: string; index: number; item: any } | null> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = `SELECT date_key, data FROM ${table} WHERE tenant_id = $1`;
      params = [tenantId];
    } else {
      query = `SELECT date_key, data FROM ${table}`;
      params = [];
    }
    const result = await this.pool.query(query, params);
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

  async getFullData(tenantId?: string): Promise<FullDataSnapshot> {
    await this._resetDailyShopQuantity(tenantId);

    let pointsQuery: string;
    let pointsParams: any[];
    if (tenantId) {
      pointsQuery = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      pointsParams = [tenantId];
    } else {
      pointsQuery = "SELECT balance FROM points WHERE id = 1";
      pointsParams = [];
    }
    const pointsResult = await this.pool.query(pointsQuery, pointsParams);

    let historyQuery: string;
    let historyParams: any[];
    if (tenantId) {
      historyQuery = "SELECT * FROM points_history WHERE tenant_id = $1 ORDER BY id ASC";
      historyParams = [tenantId];
    } else {
      historyQuery = "SELECT * FROM points_history ORDER BY id ASC";
      historyParams = [];
    }
    const historyResult = await this.pool.query(historyQuery, historyParams);

    const data: FullDataSnapshot = {
      points: {
        balance: pointsResult.rows[0]?.balance ?? 0,
        history: historyResult.rows as PointsHistoryEntry[],
      },
      badges: (await this._getJson('badges', tenantId)) ?? [],
      history: {},
      tasks: {},
      homeworks: {},
      dailySettlement: {},
      shopItems: this._filterDeleted((await this._getJson('shop_items', tenantId))) ?? [],
      redemptions: this._filterDeleted((await this._getJson('redemptions', tenantId))) ?? [],
      rewardBox: this._filterDeleted((await this._getJson('reward_box', tenantId))) ?? [],
      settings: (await this._getJson('settings', tenantId)) ?? {},
      activeBuffs: this._filterDeleted((await this._getJson('active_buffs', tenantId))) ?? [],
      efficiencyHistory: {},
      freeTimeTasks: {},
      bountyTasks: this._filterDeleted((await this._getJson('bounty_tasks', tenantId))) ?? [],
      bountySubmissions: {},
      bountyCompletions: {},
    };

    // homeworks
    let hwQuery: string;
    let hwParams: any[];
    if (tenantId) {
      hwQuery = "SELECT date_key, data FROM homeworks WHERE tenant_id = $1";
      hwParams = [tenantId];
    } else {
      hwQuery = "SELECT date_key, data FROM homeworks";
      hwParams = [];
    }
    const hwResult = await this.pool.query(hwQuery, hwParams);
    for (const row of hwResult.rows) {
      const items = this._safeJsonParse(row.data);
      if (Array.isArray(items)) {
        data.homeworks[row.date_key] = items.filter((h: any) => !h.isDeleted);
      }
    }

    // dailySettlement
    let dsQuery: string;
    let dsParams: any[];
    if (tenantId) {
      dsQuery = "SELECT date_key, data FROM daily_settlement WHERE tenant_id = $1";
      dsParams = [tenantId];
    } else {
      dsQuery = "SELECT date_key, data FROM daily_settlement";
      dsParams = [];
    }
    const dsResult = await this.pool.query(dsQuery, dsParams);
    for (const row of dsResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.dailySettlement[row.date_key] = val;
      }
    }

    // efficiencyHistory
    let ehQuery: string;
    let ehParams: any[];
    if (tenantId) {
      ehQuery = "SELECT date_key, data FROM efficiency_history WHERE tenant_id = $1";
      ehParams = [tenantId];
    } else {
      ehQuery = "SELECT date_key, data FROM efficiency_history";
      ehParams = [];
    }
    const ehResult = await this.pool.query(ehQuery, ehParams);
    for (const row of ehResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.efficiencyHistory[row.date_key] = val;
      }
    }

    // freeTimeTasks
    let ftQuery: string;
    let ftParams: any[];
    if (tenantId) {
      ftQuery = "SELECT date_key, data FROM free_time_tasks WHERE tenant_id = $1";
      ftParams = [tenantId];
    } else {
      ftQuery = "SELECT date_key, data FROM free_time_tasks";
      ftParams = [];
    }
    const ftResult = await this.pool.query(ftQuery, ftParams);
    for (const row of ftResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.freeTimeTasks[row.date_key] = this._filterDeleted(val);
      }
    }

    // bountySubmissions
    let bsQuery: string;
    let bsParams: any[];
    if (tenantId) {
      bsQuery = "SELECT date_key, data FROM bounty_submissions WHERE tenant_id = $1";
      bsParams = [tenantId];
    } else {
      bsQuery = "SELECT date_key, data FROM bounty_submissions";
      bsParams = [];
    }
    const bsResult = await this.pool.query(bsQuery, bsParams);
    for (const row of bsResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.bountySubmissions[row.date_key] = this._filterDeleted(val);
      }
    }

    // bountyCompletions
    let bcQuery: string;
    let bcParams: any[];
    if (tenantId) {
      bcQuery = "SELECT date_key, data FROM bounty_completions WHERE tenant_id = $1";
      bcParams = [tenantId];
    } else {
      bcQuery = "SELECT date_key, data FROM bounty_completions";
      bcParams = [];
    }
    const bcResult = await this.pool.query(bcQuery, bcParams);
    for (const row of bcResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        data.bountyCompletions[row.date_key] = val;
      }
    }

    return data;
  }

  async importFullData(data: any, tenantId?: string): Promise<void> {
    const points = data.points ?? {};
    const balance = typeof points === 'number' ? points : (points.balance ?? 0);

    if (tenantId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [balance, tenantId]);
      await this.pool.query("DELETE FROM points_history WHERE tenant_id = $1", [tenantId]);
    } else {
      await this.pool.query("UPDATE points SET balance = $1 WHERE id = 1", [balance]);
      await this.pool.query("DELETE FROM points_history");
    }

    const history = (typeof points === 'object' && points.history) ? points.history : [];
    for (const h of history) {
      if (tenantId) {
        await this.pool.query(
          "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6)",
          [tenantId, h.date ?? '', h.earned ?? 0, h.spent ?? 0, h.balance ?? 0, h.detail ?? '']
        );
      } else {
        await this.pool.query(
          "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)",
          [h.date ?? '', h.earned ?? 0, h.spent ?? 0, h.balance ?? 0, h.detail ?? '']
        );
      }
    }

    await this._setJson('badges', data.badges ?? [], tenantId);

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
      if (tenantId) {
        await this.pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      } else {
        await this.pool.query(`DELETE FROM ${table}`);
      }
      for (const [dk, v] of Object.entries(source)) {
        if (tenantId) {
          await this.pool.query(
            `INSERT INTO ${table} (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) DO UPDATE SET data = $3`,
            [tenantId, dk, JSON.stringify(v)]
          );
        } else {
          await this.pool.query(
            `INSERT INTO ${table} (date_key, data) VALUES ($1, $2) ON CONFLICT (date_key) DO UPDATE SET data = $2`,
            [dk, JSON.stringify(v)]
          );
        }
      }
    }

    // 单行表
    await this._setJson('shop_items', data.shopItems ?? [], tenantId);
    await this._setJson('redemptions', data.redemptions ?? [], tenantId);
    await this._setJson('reward_box', data.rewardBox ?? [], tenantId);
    await this._setJson('settings', data.settings ?? {}, tenantId);
    await this._setJson('active_buffs', data.activeBuffs ?? [], tenantId);
    await this._setJson('bounty_tasks', data.bountyTasks ?? [], tenantId);
  }

  // ==================== Notifications ====================

  async addNotification(text: string, createdAt?: number, tenantId?: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = createdAt ?? Date.now();
    if (tenantId) {
      await this.pool.query(
        'INSERT INTO notifications (tenant_id, id, text, created_at) VALUES ($1, $2, $3, $4)',
        [tenantId, id, text, now]
      );
    } else {
      await this.pool.query(
        'INSERT INTO notifications (id, text, created_at) VALUES ($1, $2, $3)',
        [id, text, now]
      );
    }
    return id;
  }

  async getPendingNotifications(tenantId?: string): Promise<NotificationItem[]> {
    const cutoff = Date.now() - 3600000;
    // 先清理过期通知
    if (tenantId) {
      await this.pool.query('DELETE FROM notifications WHERE tenant_id = $1 AND created_at < $2', [tenantId, cutoff]);
    } else {
      await this.pool.query('DELETE FROM notifications WHERE created_at < $1', [cutoff]);
    }

    let query: string;
    let params: any[];
    if (tenantId) {
      query = 'SELECT id, text, created_at FROM notifications WHERE tenant_id = $1 AND created_at >= $2 ORDER BY created_at ASC';
      params = [tenantId, cutoff];
    } else {
      query = 'SELECT id, text, created_at FROM notifications WHERE created_at >= $1 ORDER BY created_at ASC';
      params = [cutoff];
    }
    const result = await this.pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
    }));
  }

  async consumeNotifications(ids: string[], tenantId?: string): Promise<void> {
    if (ids.length === 0) return;
    const BATCH_SIZE = 500;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map((_, idx) => `$${idx + 1 + (tenantId ? 1 : 0)}`).join(',');
      if (tenantId) {
        await this.pool.query(
          `DELETE FROM notifications WHERE tenant_id = $1 AND id IN (${placeholders})`,
          [tenantId, ...batch]
        );
      } else {
        await this.pool.query(
          `DELETE FROM notifications WHERE id IN (${placeholders})`,
          batch
        );
      }
    }
  }

  // ==================== Points ====================

  async getPointsBalance(tenantId?: string): Promise<number> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      params = [tenantId];
    } else {
      query = "SELECT balance FROM points WHERE id = 1";
      params = [];
    }
    const result = await this.pool.query(query, params);
    return result.rows[0]?.balance ?? 0;
  }

  async updatePoints(action: 'earn' | 'spend', amount: number, detail: string, tenantId?: string): Promise<number> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      params = [tenantId];
    } else {
      query = "SELECT balance FROM points WHERE id = 1";
      params = [];
    }
    const result = await this.pool.query(query, params);
    let balance = result.rows[0]?.balance ?? 0;

    if (action === 'spend') {
      balance -= amount;
    } else {
      balance += amount;
    }

    if (tenantId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [balance, tenantId]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6)",
        [tenantId, today, action === 'earn' ? amount : 0, action === 'spend' ? amount : 0, balance, detail]
      );
    } else {
      await this.pool.query("UPDATE points SET balance = $1 WHE RE id = 1", [balance]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)",
        [today, action === 'earn' ? amount : 0, action === 'spend' ? amount : 0, balance, detail]
      );
    }

    return balance;
  }

  async patchPoints(delta: { earn?: number; spend?: number; detail?: string }, tenantId?: string): Promise<number> {
    let query: string;
    let params: any[];
    if (tenantId) {
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      params = [tenantId];
    } else {
      query = "SELECT balance FROM points WHERE id = 1";
      params = [];
    }
    const result = await this.pool.query(query, params);
    let balance = result.rows[0]?.balance ?? 0;

    const earned = delta.earn ?? 0;
    const spent = delta.spend ?? 0;
    balance += earned - spent;

    if (tenantId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [balance, tenantId]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6)",
        [tenantId, today, earned, spent, balance, delta.detail ?? '']
      );
      await this.recordModification('points', '1', new Date().toISOString(), tenantId);
    } else {
      await this.pool.query("UPDATE points SET balance = $1 WHERE id = 1", [balance]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)",
        [today, earned, spent, balance, delta.detail ?? '']
      );
      await this.recordModification('points', '1', new Date().toISOString());
    }

    return balance;
  }

  // ==================== Homeworks ====================

  async getHomeworks(dateKey: string, tenantId?: string): Promise<any[]> {
    return this._getDateData('homeworks', dateKey, [], tenantId);
  }

  async saveHomeworks(dateKey: string, items: any[], tenantId?: string): Promise<void> {
    await this._setDateData('homeworks', dateKey, items, tenantId);
    await this.recordModification('homeworks', dateKey, new Date().toISOString(), tenantId);
  }

  async moveHomework(fromDate: string, toDate: string, hwId: string, tenantId?: string): Promise<any | null> {
    const fromList = await this._getDateData('homeworks', fromDate, null, tenantId);
    if (!fromList) return null;

    const idx = fromList.findIndex((h: any) => h.id === hwId);
    if (idx === -1) return null;

    const [hw] = fromList.splice(idx, 1);
    await this._setDateData('homeworks', fromDate, fromList, tenantId);

    const toList = await this._getDateData('homeworks', toDate, [], tenantId);
    toList.push(hw);
    await this._setDateData('homeworks', toDate, toList, tenantId);

    const now = new Date().toISOString();
    await this.recordModification('homeworks', fromDate, now, tenantId);
    await this.recordModification('homeworks', toDate, now, tenantId);

    return hw;
  }

  async getHomeworkById(id: string, tenantId?: string): Promise<any | null> {
    const found = await this._findRecordById('homeworks', id, tenantId);
    return found?.item && !found.item.isDeleted ? found.item : null;
  }

  async putHomework(id: string, data: any, tenantId?: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id, tenantId);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing && !existing.item.isDeleted) {
      const items = await this._getDateDataRaw('homeworks', existing.dateKey, tenantId);
      if (!Array.isArray(items)) {
        await this._setDateData('homeworks', existing.dateKey, [data], tenantId);
        await this.recordModification('homeworks', existing.dateKey, now, tenantId);
        return;
      }
      items[existing.index] = data;
      await this._setDateData('homeworks', existing.dateKey, items, tenantId);
      await this.recordModification('homeworks', existing.dateKey, now, tenantId);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      let items = await this._getDateDataRaw('homeworks', dateKey, tenantId);
      if (!Array.isArray(items)) {
        items = [];
      }
      items.push(data);
      await this._setDateData('homeworks', dateKey, items, tenantId);
      await this.recordModification('homeworks', dateKey, now, tenantId);
    }
  }

  async patchHomework(id: string, fields: any, tenantId?: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id, tenantId);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = await this._getDateDataRaw('homeworks', existing.dateKey, tenantId);
    items[existing.index] = { ...items[existing.index], ...fields, lastModified: now };
    await this._setDateData('homeworks', existing.dateKey, items, tenantId);
    await this.recordModification('homeworks', existing.dateKey, now, tenantId);
  }

  async deleteHomework(id: string, tenantId?: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id, tenantId);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = await this._getDateDataRaw('homeworks', existing.dateKey, tenantId);
    items[existing.index].isDeleted = true;
    items[existing.index].lastModified = now;
    await this._setDateData('homeworks', existing.dateKey, items, tenantId);
    await this.recordModification('homeworks', existing.dateKey, now, tenantId);
  }

  // ==================== Settlement ====================

  async getSettlement(dateKey: string, tenantId?: string): Promise<any> {
    return this._getDateData('daily_settlement', dateKey, null, tenantId);
  }

  async saveSettlement(dateKey: string, data: any, tenantId?: string): Promise<void> {
    await this._setDateData('daily_settlement', dateKey, data, tenantId);
    await this.recordModification('daily_settlement', dateKey, new Date().toISOString(), tenantId);
  }

  async putSettlement(dateKey: string, data: any, tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('daily_settlement', dateKey, data, tenantId);
    await this.recordModification('daily_settlement', dateKey, now, tenantId);
  }

  async patchSettlement(dateKey: string, fields: any, tenantId?: string): Promise<void> {
    const existing = (await this._getDateDataRaw('daily_settlement', dateKey, tenantId)) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    await this._setDateData('daily_settlement', dateKey, merged, tenantId);
    await this.recordModification('daily_settlement', dateKey, now, tenantId);
  }

  // ==================== Shop ====================

  async getShopItems(tenantId?: string): Promise<any[]> {
    await this._resetDailyShopQuantity(tenantId);
    return (await this._getJson('shop_items', tenantId)) ?? [];
  }

  async saveShopItems(items: any[], tenantId?: string): Promise<void> {
    await this._setJson('shop_items', items, tenantId);
    await this.recordModification('shop_items', '1', new Date().toISOString(), tenantId);
  }

  async getShopItemById(id: string, tenantId?: string): Promise<any | null> {
    const items = (await this._getJson('shop_items', tenantId)) ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putShopItem(id: string, data: any, tenantId?: string): Promise<void> {
    const items = (await this._getJson('shop_items', tenantId)) ?? [];
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

    await this._setJson('shop_items', items, tenantId);
    await this.recordModification('shop_items', '1', now, tenantId);
  }

  async deleteShopItem(id: string, tenantId?: string): Promise<void> {
    const items = (await this._getJson('shop_items', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('shop_items', items, tenantId);
    await this.recordModification('shop_items', '1', now, tenantId);
  }

  // ==================== Redemptions ====================

  async getRedemptions(tenantId?: string): Promise<any[]> {
    return (await this._getJson('redemptions', tenantId)) ?? [];
  }

  async saveRedemptions(items: any[], tenantId?: string): Promise<void> {
    await this._setJson('redemptions', items, tenantId);
    await this.recordModification('redemptions', '1', new Date().toISOString(), tenantId);
  }

  async clearFulfilledRedemptions(tenantId?: string): Promise<void> {
    const items = (await this._getJson('redemptions', tenantId)) ?? [];
    const remaining = items.filter((r: any) => r.status !== 'fulfilled');
    await this._setJson('redemptions', remaining, tenantId);
    await this.recordModification('redemptions', '1', new Date().toISOString(), tenantId);
  }

  async putRedemption(id: string, data: any, tenantId?: string): Promise<void> {
    const items = (await this._getJson('redemptions', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('redemptions', items, tenantId);
    await this.recordModification('redemptions', '1', now, tenantId);
  }

  // ==================== Reward Box ====================

  async getRewardBox(tenantId?: string): Promise<any[]> {
    return this._filterDeleted((await this._getJson('reward_box', tenantId))) ?? [];
  }

  async saveRewardBox(items: any[], tenantId?: string): Promise<void> {
    await this._setJson('reward_box', items, tenantId);
    await this.recordModification('reward_box', '1', new Date().toISOString(), tenantId);
  }

  async putRewardBoxItem(id: string, data: any, tenantId?: string): Promise<void> {
    const items = (await this._getJson('reward_box', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('reward_box', items, tenantId);
    await this.recordModification('reward_box', '1', now, tenantId);
  }

  async deleteRewardBoxItem(id: string, tenantId?: string): Promise<void> {
    const items = (await this._getJson('reward_box', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('reward_box', items, tenantId);
    await this.recordModification('reward_box', '1', now, tenantId);
  }

  // ==================== Settings ====================

  async getSettings(tenantId?: string): Promise<any> {
    return (await this._getJson('settings', tenantId)) ?? {};
  }

  async saveSettings(data: any, tenantId?: string): Promise<void> {
    await this._setJson('settings', data, tenantId);
    await this.recordModification('settings', '1', new Date().toISOString(), tenantId);
  }

  async putSettings(data: any, tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setJson('settings', data, tenantId);
    await this.recordModification('settings', '1', now, tenantId);
  }

  async patchSettings(fields: any, tenantId?: string): Promise<void> {
    const existing = (await this._getJson('settings', tenantId)) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    await this._setJson('settings', merged, tenantId);
    await this.recordModification('settings', '1', now, tenantId);
  }

  // ==================== Active Buffs ====================

  async getActiveBuffs(tenantId?: string): Promise<any[]> {
    return (await this._getJson('active_buffs', tenantId)) ?? [];
  }

  async saveActiveBuffs(items: any[], tenantId?: string): Promise<void> {
    await this._setJson('active_buffs', items, tenantId);
    await this.recordModification('active_buffs', '1', new Date().toISOString(), tenantId);
  }

  async putBuff(id: string, data: any, tenantId?: string): Promise<void> {
    const items = (await this._getJson('active_buffs', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('active_buffs', items, tenantId);
    await this.recordModification('active_buffs', '1', now, tenantId);
  }

  async deleteBuff(id: string, tenantId?: string): Promise<void> {
    const items = (await this._getJson('active_buffs', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('active_buffs', items, tenantId);
    await this.recordModification('active_buffs', '1', now, tenantId);
  }

  // ==================== Efficiency ====================

  async getEfficiency(dateKey: string, tenantId?: string): Promise<any> {
    return this._getDateData('efficiency_history', dateKey, null, tenantId);
  }

  async saveEfficiency(dateKey: string, data: any, tenantId?: string): Promise<void> {
    await this._setDateData('efficiency_history', dateKey, data, tenantId);
    await this.recordModification('efficiency_history', dateKey, new Date().toISOString(), tenantId);
  }

  async putEfficiency(dateKey: string, data: any, tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('efficiency_history', dateKey, data, tenantId);
    await this.recordModification('efficiency_history', dateKey, now, tenantId);
  }

  // ==================== Free Time ====================

  async getFreeTime(dateKey: string, tenantId?: string): Promise<any[]> {
    return this._getDateData('free_time_tasks', dateKey, [], tenantId);
  }

  async saveFreeTime(dateKey: string, tasks: any[], tenantId?: string): Promise<void> {
    await this._setDateData('free_time_tasks', dateKey, tasks, tenantId);
    await this.recordModification('free_time_tasks', dateKey, new Date().toISOString(), tenantId);
  }

  async putFreeTimeTask(id: string, data: any, tenantId?: string): Promise<void> {
    const existing = await this._findRecordById('free_time_tasks', id, tenantId);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = await this._getDateDataRaw('free_time_tasks', existing.dateKey, tenantId);
      items[existing.index] = data;
      await this._setDateData('free_time_tasks', existing.dateKey, items, tenantId);
      await this.recordModification('free_time_tasks', existing.dateKey, now, tenantId);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      const items = (await this._getDateDataRaw('free_time_tasks', dateKey, tenantId)) ?? [];
      items.push(data);
      await this._setDateData('free_time_tasks', dateKey, items, tenantId);
      await this.recordModification('free_time_tasks', dateKey, now, tenantId);
    }
  }

  // ==================== Bounty Tasks ====================

  async getBountyTasks(tenantId?: string): Promise<any[]> {
    return (await this._getJson('bounty_tasks', tenantId)) ?? [];
  }

  async saveBountyTasks(items: any[], tenantId?: string): Promise<void> {
    await this._setJson('bounty_tasks', items, tenantId);
    await this.recordModification('bounty_tasks', '1', new Date().toISOString(), tenantId);
  }

  async getBountyTaskById(id: string, tenantId?: string): Promise<any | null> {
    const items = (await this._getJson('bounty_tasks', tenantId)) ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putBountyTask(id: string, data: any, tenantId?: string): Promise<void> {
    const items = (await this._getJson('bounty_tasks', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('bounty_tasks', items, tenantId);
    await this.recordModification('bounty_tasks', '1', now, tenantId);
  }

  async deleteBountyTask(id: string, tenantId?: string): Promise<void> {
    const items = (await this._getJson('bounty_tasks', tenantId)) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('bounty_tasks', items, tenantId);
    await this.recordModification('bounty_tasks', '1', now, tenantId);
  }

  // ==================== Bounty Submissions ====================

  async getBountySubmissions(dateKey: string, tenantId?: string): Promise<any[]> {
    return this._getDateData('bounty_submissions', dateKey, [], tenantId);
  }

  async saveBountySubmissions(dateKey: string, data: any[], tenantId?: string): Promise<void> {
    await this._setDateData('bounty_submissions', dateKey, data, tenantId);
    await this.recordModification('bounty_submissions', dateKey, new Date().toISOString(), tenantId);
  }

  async putBountySubmission(id: string, data: any, tenantId?: string): Promise<void> {
    const existing = await this._findRecordById('bounty_submissions', id, tenantId);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = await this._getDateDataRaw('bounty_submissions', existing.dateKey, tenantId);
      items[existing.index] = data;
      await this._setDateData('bounty_submissions', existing.dateKey, items, tenantId);
      await this.recordModification('bounty_submissions', existing.dateKey, now, tenantId);
    } else {
      const dateKey = data.dateKey ?? data.date ?? new Date().toISOString().slice(0, 10);
      const items = (await this._getDateDataRaw('bounty_submissions', dateKey, tenantId)) ?? [];
      items.push(data);
      await this._setDateData('bounty_submissions', dateKey, items, tenantId);
      await this.recordModification('bounty_submissions', dateKey, now, tenantId);
    }
  }

  // ==================== Bounty Completions ====================

  async getBountyCompletions(dateKey: string, tenantId?: string): Promise<any> {
    return this._getDateData('bounty_completions', dateKey, {}, tenantId);
  }

  async saveBountyCompletions(dateKey: string, data: any, tenantId?: string): Promise<void> {
    await this._setDateData('bounty_completions', dateKey, data, tenantId);
    await this.recordModification('bounty_completions', dateKey, new Date().toISOString(), tenantId);
  }

  async putBountyCompletion(id: string, data: any, tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('bounty_completions', id, data, tenantId);
    await this.recordModification('bounty_completions', id, now, tenantId);
  }

  // ==================== Email Config ====================

  async getEmailConfig(tenantId?: string): Promise<any | null> {
    const data = await this._getJson('email_config', tenantId);
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return data;
    }
    return null;
  }

  async saveEmailConfig(config: any, tenantId?: string): Promise<void> {
    await this._setJson('email_config', config, tenantId);
    await this.recordModification('email_config', '1', new Date().toISOString(), tenantId);
  }

  // ==================== Sync ====================

  async getModifiedSince(timestamp: string, tenantId?: string): Promise<ModifiedEntry[]> {
    let result: QueryResult;
    if (tenantId) {
      result = await this.pool.query(
        'SELECT table_name, record_key, last_modified FROM last_modified WHERE tenant_id = $1 AND last_modified > $2',
        [tenantId, timestamp]
      );
    } else {
      result = await this.pool.query(
        'SELECT table_name, record_key, last_modified FROM last_modified WHERE last_modified > $1',
        [timestamp]
      );
    }

    const rows: ModifiedEntry[] = [];

    for (const row of result.rows) {
      const table = row.table_name;
      const recordKey = row.record_key;

      if (table === 'points') {
        let pointsResult: QueryResult;
        if (tenantId) {
          pointsResult = await this.pool.query("SELECT balance FROM points WHERE tenant_id = $1 AND id = 1", [tenantId]);
        } else {
          pointsResult = await this.pool.query("SELECT balance FROM points WHERE id = 1");
        }
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
        data = await this._getDateData(table, recordKey, undefined, tenantId);
      } else if (SINGLE_ROW_TABLES.has(table)) {
        data = await this._getJson(table, tenantId, parseInt(recordKey, 10));
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

  async pushMerge(changes: any[], tenantId?: string): Promise<{ ok: boolean }> {
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
        if (tenantId) {
          await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [newBalance, tenantId]);
        } else {
          await this.pool.query("UPDATE points SET balance = $1 WHERE id = 1", [newBalance]);
        }
        await this.recordModification('points', '1', timestamp, tenantId);
        continue;
      }

      if (DATE_KEY_TABLES.has(table)) {
        const recordKey = data.date || data.dateKey || uuid || '';
        if (!recordKey) continue;

            const existing = await this._getDateDataRaw(table, recordKey, tenantId);
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

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
          await this._setDateData(table, recordKey, existingList, tenantId);
          await this.recordModification(table, recordKey, timestamp, tenantId);
        } else if (existingDict !== null) {                              
          const oldLast = existingDict.lastModified ?? '0';
          if (changeType === 'delete') {
            data.isDeleted = true;
            await this._setDateData(table, recordKey, data, tenantId);
          } else if (newLastModified >= oldLast) {
            await this._setDateData(table, recordKey, data, tenantId);
          }
          await this.recordModification(table, recordKey, timestamp, tenantId);
        }                              
     } else if (SINGLE_ROW_TABLES.has(table)) {
      const existing = await this._getJson(table, tenantId, 1);
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
        }
      }
}

    return { ok: true };
  }

  // ==================== Sync ====================
  
  async recordModification(tableName: string, recordKey: string, timestamp: string, tenantId?: string): Promise<void> {
if (tenantId) {
await this.pool.query(
        'INSERT INTO last_modified (tenant_id, table_name, record_key, last_modified) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, table_name, record_key) DO UPDATE SET last_modified = $4',
        [tenantId, tableName, recordKey, timestamp]
      );
    } else {
      await this.pool.query(
        'INSERT INTO last_modified (table_name, record_key, last_modified) VALUES ($1, $2, $3) ON CONFLICT (table_name, record_key) DO UPDATE SET last_modified = $3',
        [tableName, recordKey, timestamp]
  );
    }
  }

  // ==================== Misc ====================

  async resetDate(dateKey: string, tenantId?: string): Promise<void> {
    if (tenantId) {
      await this.pool.query("DELETE FROM homeworks WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
      await this.pool.query("DELETE FROM daily_settlement WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
    await this.pool.query("DELETE FROM efficiency_history WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
    await this.pool.query("DELETE FROM free_time_tasks WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
    await this.pool.query("DELETE FROM bounty_submissions WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
    await this.pool.query("DELETE FROM bounty_completions WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
    } else {
    await this.pool.query("DELETE FROM homeworks WHERE date_key = $1", [dateKey]);
      await this.pool.query("DELETE FROM daily_settlement WHERE date_key = $1", [dateKey]);
      await this.pool.query("DELETE FROM efficiency_history WHERE date_key = $1", [dateKey]);
      await this.pool.query("DELETE FROM free_time_tasks WHERE date_key = $1", [dateKey]);
      await this.pool.query("DELETE FROM bounty_submissions WHERE date_key = $1", [dateKey]);
      await this.pool.query("DELETE FROM bounty_completions WHERE date_key = $1", [dateKey]);
    }

    // 清理与当日相关的 active_buffs
    const buffs = (await this._getJson('active_buffs', tenantId)) ?? [];
    const beforeCount = buffs.length;
    const parts = dateKey.split('-');
    if (parts.length !== 3) return;                          
    const isoPrefix = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    const filteredBuffs = buffs.filter((b: any) =>
b.startDate !== dateKey && !b.startDate?.startsWith(isoPrefix)
  );
    if (filteredBuffs.length !== beforeCount) {
      await this._setJson('active_buffs', filteredBuffs, tenantId);
    }

    if (tenantId) {
      await this.pool.query("DELETE FROM meta WHERE tenant_id = $1 AND key = 'last_shop_reset'", [tenantId]);
    } else {
      await this.pool.query("DELETE FROM meta WHERE tenant_id IS NULL AND key = 'last_shop_reset'");
    }
  }                          

  // ==================== CRDT Operations ====================

  async saveCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void> {
    if (tenantId) {    
    await this.pool.query(
      `INSERT INTO crdt_operations (tenant_id, id, type, table_name, resource_id, field, value, timestamp, node_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, id) DO UPDATE SET
           type = $3, table_name = $4, resource_id = $5, field = $6,
           value = $7, timestamp = $8, node_id = $9`,
        [tenantId, op.id, op.type, op.table, op.resourceId, op.field, JSON.stringify(op.value), op.timestamp, op.nodeId]
      );
    } else {
      await this.pool.query(
        `INSERT INTO crdt_operations (id, type, table_name, resource_id, field, value, timestamp, node_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           type = $2, table_name = $3, resource_id = $4, field = $5,
           value = $6, timestamp = $7, node_id = $8`,
        [op.id, op.type, op.table, op.resourceId, op.field, JSON.stringify(op.value), op.timestamp, op.nodeId]
      );
    }
  }

  async applyCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void> {
    try {
      if (op.type === 'delete') {
        switch (op.table) {
          case 'homeworks': await this.deleteHomework(op.resourceId, tenantId); break;
          case 'shop_items': await this.deleteShopItem(op.resourceId, tenantId); break;
          case 'active_buffs': await this.deleteBuff(op.resourceId, tenantId); break;
          case 'bounty_tasks': await this.deleteBountyTask(op.resourceId, tenantId); break;
          case 'reward_box': await this.deleteRewardBoxItem(op.resourceId, tenantId); break;
        }
      } else if (op.type === 'update' && op.value) {
        switch (op.table) {
          case 'homeworks': {
            const existingHw = await this._findRecordById('homeworks', op.resourceId, tenantId);
            if (existingHw) {
              await this.patchHomework(op.resourceId, op.value, tenantId);
            } else {
              await this.putHomework(op.resourceId, op.value, tenantId);
            }
            break;
          }
          case 'shop_items': await this.putShopItem(op.resourceId, op.value, tenantId); break;
          case 'bounty_tasks': await this.putBountyTask(op.resourceId, op.value, tenantId); break;
          case 'bounty_submissions': await this.putBountySubmission(op.resourceId, op.value, tenantId); break;
          case 'bounty_completions': await this.putBountyCompletion(op.resourceId, op.value, tenantId); break;
          case 'redemptions': await this.putRedemption(op.resourceId, op.value, tenantId); break;
          case 'reward_box': await this.putRewardBoxItem(op.resourceId, op.value, tenantId); break;
          case 'active_buffs': await this.putBuff(op.resourceId, op.value, tenantId); break;
          case 'free_time_tasks': await this.putFreeTimeTask(op.resourceId, op.value, tenantId); break;
          case 'daily_settlement': await this.putSettlement(op.resourceId, op.value, tenantId); break;
          case 'settings': await this.putSettings(op.value, tenantId); break;
          case 'notifications':
            await this.addNotification(op.value.text, op.value.createdAt, tenantId);
            break;
        }
      }
    } catch (e) {
      console.error('Failed to apply CRDT operation', op, e);
    }
  }

  async getCRDTOperationsSince(timestamp: string, tenantId?: string): Promise<CRDTOperation[]> {
    let result: QueryResult;
    if (tenantId) {
      result = await this.pool.query(
        'SELECT * FROM crdt_operations WHERE tenant_id = $1 AND timestamp > $2 ORDER BY timestamp ASC',
        [tenantId, timestamp]
      );
    } else {
      result = await this.pool.query(
        'SELECT * FROM crdt_operations WHERE timestamp > $1 ORDER BY timestamp ASC',
        [timestamp]
      );
    }
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

  async ackCRDTOperations(timestamp: string, tenantId?: string): Promise<void> {
    if (tenantId) {
      await this.pool.query(
        'DELETE FROM crdt_operations WHERE tenant_id = $1 AND timestamp <= $2',
        [tenantId, timestamp]
      );
    } else {
      await this.pool.query(
        'DELETE FROM crdt_operations WHERE timestamp <= $1',
        [timestamp]
      );
    }
  }

  // ==================== Auth ====================

  async queryUserTokenVersion(userId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT token_version FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );
    return result.rows[0]?.token_version ?? 1;
  }

  async findUserByAccessHash(accessHash: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE is_active = true'
    );
    for (const row of result.rows) {
      if (bcrypt.compareSync(accessHash, row.access_hash)) {
        return {
          id: row.id,
          tenant_id: row.tenant_id,
          role: row.role,
          nickname: row.nickname,
          access_hash: row.access_hash,
          token_version: row.token_version,
          is_active: row.is_active,
          created_at: row.created_at,
          last_login: row.last_login ?? undefined,
        };
      }
    }
    return null;
  }

  async getUserById(userId: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      role: row.role,
      nickname: row.nickname,
      access_hash: row.access_hash,
      token_version: row.token_version,
      is_active: row.is_active,
      created_at: row.created_at,
      last_login: row.last_login ?? undefined,
    };
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    await this.pool.query(
      "UPDATE users SET last_login = NOW() WHERE id = $1",
      [userId]
    );
  }

  // ==================== Admin / Members ====================

  async createTenant(id: string, name: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [id, name]
    );
  }

  async createUser(input: any): Promise<void> {
    await this.pool.query(
      'INSERT INTO users (id, tenant_id, role, nickname, access_hash, access_code_plaintext, token_version, email, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING',
      [input.id, input.tenant_id, input.role, input.nickname, input.access_hash, input.access_code_plaintext ?? null, input.token_version, input.email ?? null, input.password_hash ?? null]
    );
  }

  async findAdminByEmail(email: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      email: row.email,
      password_hash: row.password_hash,
      token_version: row.token_version,
    };
  }

  async getTenantMembers(tenantId: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE tenant_id = $1 AND is_active = true ORDER BY created_at ASC',
      [tenantId]
    );
    return result.rows.map(row => ({
      id: row.id,
      tenant_id: row.tenant_id,
      role: row.role,
      nickname: row.nickname,
      access_hash: row.access_hash,
      access_code_plaintext: row.access_code_plaintext,
      token_version: row.token_version,
      last_login: row.last_login ?? undefined,
      created_at: row.created_at,
    }));
  }

  async regenerateMemberHash(userId: string, tenantId: string, newHash: string, newPlaintext?: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE users SET access_hash = $1, access_code_plaintext = $2, token_version = token_version + 1 WHERE id = $3 AND tenant_id = $4 AND is_active = true',
      [newHash, newPlaintext ?? null, userId, tenantId]
    );
    if (result.rowCount === 0) {
      throw new Error('成员不存在或不属于该租户');
    }
  }

  async deactivateMember(userId: string, tenantId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET is_active = false WHERE id = $1 AND tenant_id = $2',
      [userId, tenantId]
    );
  }

  async updateTenantAdmin(tenantId: string, adminUserId: string): Promise<void> {
    await this.pool.query(
      'UPDATE tenants SET admin_id = $1 WHERE id = $2',
      [adminUserId, tenantId]
    );
  }

  async updateTenantName(tenantId: string, newName: string): Promise<void> {
    await this.pool.query(
      'UPDATE tenants SET name = $1 WHERE id = $2',
      [newName, tenantId]
    );
  }

  // ==================== Super Admin ====================

  async findSuperAdmin(username: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_super_admin = true AND is_active = true',
      [username]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id ?? '__super_admin__',
      email: row.email,
      password_hash: row.password_hash,
      token_version: row.token_version,
    };
  }

  async updateSuperAdminCredentials(userId: string, email: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET email = $1, password_hash = $2, needs_password_change = false, token_version = token_version + 1 WHERE id = $3',
      [email, passwordHash, userId]
    );
  }

  async getAllTenants(): Promise<TenantListItem[]> {
    const result = await this.pool.query(`
      SELECT t.id, t.name, t.is_active, t.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = true) AS member_count
      FROM tenants t
      ORDER BY t.created_at ASC
    `);
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      member_count: parseInt(row.member_count, 10),
      is_active: !!row.is_active,
      created_at: row.created_at,
    }));
  }

  async setTenantActive(tenantId: string, isActive: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE tenants SET is_active = $2 WHERE id = $1',
      [tenantId, isActive]
    );
  }

  // ==================== Connection ====================

  async close(): Promise<void> {
    await this.pool.end();
  }
}
