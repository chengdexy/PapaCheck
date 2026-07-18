import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { Pool as PoolType, QueryResult, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import { DatabaseAdapter } from './adapter.js';
import type { FullDataSnapshot, PointsHistoryEntry, ModifiedEntry, NotificationItem, TenantListItem, ChildrenRecord, AccessCodeRecord, CreateAccessCodeInput, AdminUser, BackupRecord, HealthRecord, AlertState, OpsConfig, StatsResult, StatsRangeInput } from './types.js';
import type { HomeworkDTO, SettlementDTO, EfficiencyDTO, ShopItemDTO, RedemptionDTO, RewardBoxItemDTO, BuffDTO, FreeTimeTaskDTO, BountyTaskDTO, BountySubmissionDTO, BountyCompletionDTO, SettingsDTO, EmailConfigDTO } from './dto.js';
import type { CRDTOperation } from '../crdt/types.js';
import { buildStatsFromData } from './stats.js';

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

/** 共享表：不分配 child_id */
const SHARED_TABLES = new Set([
  'shop_items',
  'settings',
  'bounty_tasks',
  'email_config',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== PostgresAdapter ====================

export class PostgresAdapter extends DatabaseAdapter {
  pool: PoolType;

  private constructor(connectionString: string, poolConfig?: { max?: number; idleTimeoutMillis?: number }) {
    super();
    this.pool = new Pool({ connectionString, ...poolConfig });
  }

  static async create(connectionString: string, poolConfig?: { max?: number; idleTimeoutMillis?: number }): Promise<PostgresAdapter> {
    const instance = new PostgresAdapter(connectionString, poolConfig);
    await instance._initSchema();
    return instance;
  }

  // ==================== Schema Init ====================

  private async _initSchema(): Promise<void> {
    // 检查 schema 是否已初始化（通过检测 tenants 表是否存在行）
    // 避免并发测试时重复执行 DDL 导致冲突
    const checkResult = await this.pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = \'tenants\') AS has_table'
    );
    if (!checkResult.rows[0].has_table) {
      // 首次运行：执行完整 DDL schema
      const schemaPath = resolve(__dirname, '../../scripts/init-pg-schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');
      await this.pool.query(schema);
    }

    // 获取首个已存在的租户 ID（如果表为空则创建一个默认租户）
    const tenantResult = await this.pool.query('SELECT id FROM tenants LIMIT 1');
    let effectiveTenantId: string;
    if (tenantResult.rows.length > 0) {
      effectiveTenantId = tenantResult.rows[0].id;
    } else {
      effectiveTenantId = crypto.randomUUID();
      await this.pool.query(
        `INSERT INTO tenants (id, name) VALUES ($1, '默认租户') ON CONFLICT (name) DO NOTHING`,
        [effectiveTenantId]
      );
      // 重新读取实际 tenant id：若 INSERT 因并发冲突被跳过，使用已有记录的 id
      const afterInsert = await this.pool.query(
        "SELECT id FROM tenants WHERE name = '默认租户' LIMIT 1"
      );
      if (afterInsert.rows.length > 0) {
        effectiveTenantId = afterInsert.rows[0].id;
      }
    }

    // Insert default rows for each tenant's shared single-row tables
    // Per-child tables (redemptions, badges, reward_box, active_buffs) are initialized per-child
    const singleRowDefaults: Array<{ table: string; data: string }> = [
      { table: 'shop_items', data: '[]' },
      { table: 'settings', data: '{}' },
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

  private async _getJson(table: string, tenantId?: string, childId?: string, idValue: number = 1): Promise<any> {
    // 快速失败：tenantId 缺失时禁止静默退化为全表查询，避免跨租户数据泄漏。
    // 系统级 / 跨租户操作请使用不带 tenantId 的专用方法。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = `SELECT data FROM ${table} WHERE tenant_id = $1 AND child_id = $2 AND id = $3`;
      params = [tenantId, childId, idValue];
    } else {
      // tenantId 已确保存在：此处为「仅租户、无 child」维度的查询
      query = `SELECT data FROM ${table} WHERE tenant_id = $1 AND id = $2`;
      params = [tenantId, idValue];
    }
    const result = await this.pool.query(query, params);
    if (result.rows.length === 0) return null;
    return this._safeJsonParse(result.rows[0].data) ?? null;
  }

  private async _setJson(table: string, data: any, tenantId?: string, childId?: string, idValue: number = 1): Promise<void> {
    // 使用 UPDATE + INSERT 策略，而非 INSERT ON CONFLICT DO UPDATE
    // 原因：多孩子迁移后 redemptions/reward_box/active_buffs/badges 的 PK 被替换为
    // 部分唯一索引 (WHERE child_id IS NULL)，INSERT ON CONFLICT 无法指定匹配的冲突目标
    // 快速失败：tenantId 缺失时禁止静默退化为全表写入（多租户隔离）
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let setClause: string;
    let whereClause: string;
    let whereParams: any[];
    let insertCols: string;
    let insertValues: string;
    let insertParams: any[];
    const jsonData = JSON.stringify(data);

    if (tenantId && childId) {
      setClause = `UPDATE ${table} SET data = $1`;
      whereClause = `WHERE tenant_id = $2 AND child_id = $3 AND id = $4`;
      whereParams = [jsonData, tenantId, childId, idValue];
      insertCols = `(tenant_id, child_id, id, data)`;
      insertValues = `VALUES ($1, $2, $3, $4)`;
      insertParams = [tenantId, childId, idValue, jsonData];
    } else {
      // tenantId 已确保存在：仅租户维度
      setClause = `UPDATE ${table} SET data = $1`;
      whereClause = `WHERE tenant_id = $2 AND id = $3`;
      whereParams = [jsonData, tenantId, idValue];
      insertCols = `(tenant_id, id, data)`;
      insertValues = `VALUES ($1, $2, $3)`;
      insertParams = [tenantId, idValue, jsonData];
    }

    const result = await this.pool.query(
      `${setClause} ${whereClause}`,
      whereParams
    );
    if (result.rowCount === 0) {
      // ON CONFLICT DO NOTHING 无需指定冲突目标，安全兜底并发插入
      await this.pool.query(
        `INSERT INTO ${table} ${insertCols} ${insertValues} ON CONFLICT DO NOTHING`,
        insertParams
      );
    }
  }

  private async _getDateDataRaw(table: string, dateKey: string, tenantId?: string, childId?: string): Promise<any> {
    // 快速失败：tenantId 缺失时禁止静默退化为全表查询（多租户隔离）
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = `SELECT data FROM ${table} WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3`;
      params = [tenantId, childId, dateKey];
    } else {
      // tenantId 已确保存在：仅租户维度
      query = `SELECT data FROM ${table} WHERE tenant_id = $1 AND date_key = $2`;
      params = [tenantId, dateKey];
    }
    const result = await this.pool.query(query, params);
    if (result.rows.length === 0) return undefined;
    return this._safeJsonParse(result.rows[0].data);
  }

  private async _getDateData(table: string, dateKey: string, defaultVal: any = null, tenantId?: string, childId?: string): Promise<any> {
    const data = await this._getDateDataRaw(table, dateKey, tenantId, childId);
    if (data === undefined) return defaultVal;
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  private async _setDateData(table: string, dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void> {
    // 快速失败：tenantId 缺失时禁止写入无租户归属的数据行，避免跨租户数据污染。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = `INSERT INTO ${table} (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4`;
      params = [tenantId, childId, dateKey, JSON.stringify(data)];
    } else {
      // tenantId 已确保存在：此处为「仅租户、无 child」维度的写入
      query = `INSERT INTO ${table} (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3`;
      params = [tenantId, dateKey, JSON.stringify(data)];
    }
    await this.pool.query(query, params);
  }

  /**
   * 系统级存活探测（ops/监控使用）。不要求 tenantId，永不因缺 tenantId 而抛错。
   * 区别于租户级读写方法：仅用于健康检查时判断 Postgres 是否可达。
   */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /**
   * 在单连接事务中执行回调（BEGIN / COMMIT / ROLLBACK 自动管理）。
   * 供需要「行锁 + 原子读写」的场景复用（如 defer-homework approve）。
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* 回滚失败不影响已抛出的原错误 */
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /** 计算下一天（YYYY-MM-DD），校验输入格式 */
  private _getTomorrow(dateStr: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error(`无效的日期格式: ${dateStr}`);
    }
    const d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d.getTime())) {
      throw new Error(`无效的日期: ${dateStr}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  /** 在指定连接（事务内）上记录变更戳，保证与业务写入原子提交 */
  private async _recordModificationOnClient(
    client: PoolClient,
    tableName: string,
    recordKey: string,
    timestamp: string,
    tenantId: string,
  ): Promise<void> {
    await client.query(
      'INSERT INTO last_modified (tenant_id, table_name, record_key, last_modified) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, table_name, record_key) DO UPDATE SET last_modified = $4',
      [tenantId, tableName, recordKey, timestamp],
    );
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
  async _findRecordById(table: string, id: string, tenantId?: string, childId?: string): Promise<{ dateKey: string; index: number; item: any } | null> {
    // 快速失败：tenantId 缺失时禁止静默退化为全表扫描（多租户隔离）
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = `SELECT date_key, data FROM ${table} WHERE tenant_id = $1 AND child_id = $2`;
      params = [tenantId, childId];
    } else {
      // tenantId 已确保存在：仅租户维度
      query = `SELECT date_key, data FROM ${table} WHERE tenant_id = $1`;
      params = [tenantId];
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

  async getFullData(tenantId?: string, childId?: string): Promise<FullDataSnapshot> {
    // 快速失败：全量快照为租户级操作，缺失 tenantId 时禁止静默退化为跨租户读取
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    await this._resetDailyShopQuantity(tenantId);

    let pointsQuery: string;
    let pointsParams: any[];
    if (tenantId && childId) {
      pointsQuery = "SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1";
      pointsParams = [tenantId, childId];
    } else if (tenantId) {
      pointsQuery = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      pointsParams = [tenantId];
    } else {
      pointsQuery = "SELECT balance FROM points WHERE id = 1";
      pointsParams = [];
    }
    const pointsResult = await this.pool.query(pointsQuery, pointsParams);

    // 注意（design §B.4）：已停止返回 points.history（前端仅用 balance，零消费）。
    // 其余废弃字段 badges / history / tasks / efficiencyHistory 同样不再返回（前端零消费，grep 确认）。
    const data: FullDataSnapshot = {
      points: {
        balance: pointsResult.rows[0]?.balance ?? 0,
      },
      homeworks: {},
      dailySettlement: {},
      shopItems: this._filterDeleted((await this._getJson('shop_items', tenantId))) ?? [],
      redemptions: this._filterDeleted((await this._getJson('redemptions', tenantId, childId))) ?? [],
      rewardBox: this._filterDeleted((await this._getJson('reward_box', tenantId, childId))) ?? [],
      settings: (await this._getJson('settings', tenantId)) ?? {},
      activeBuffs: this._filterDeleted((await this._getJson('active_buffs', tenantId, childId))) ?? [],
      freeTimeTasks: {},
      bountyTasks: this._filterDeleted((await this._getJson('bounty_tasks', tenantId))) ?? [],
      bountySubmissions: {},
      bountyCompletions: {},
    };

    // homeworks
    let hwQuery: string;
    let hwParams: any[];
    if (tenantId && childId) {
      hwQuery = "SELECT date_key, data FROM homeworks WHERE tenant_id = $1 AND child_id = $2";
      hwParams = [tenantId, childId];
    } else if (tenantId) {
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
    if (tenantId && childId) {
      dsQuery = "SELECT date_key, data FROM daily_settlement WHERE tenant_id = $1 AND child_id = $2";
      dsParams = [tenantId, childId];
    } else if (tenantId) {
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

    // freeTimeTasks
    let ftQuery: string;
    let ftParams: any[];
    if (tenantId && childId) {
      ftQuery = "SELECT date_key, data FROM free_time_tasks WHERE tenant_id = $1 AND child_id = $2";
      ftParams = [tenantId, childId];
    } else if (tenantId) {
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
    if (tenantId && childId) {
      bsQuery = "SELECT date_key, data FROM bounty_submissions WHERE tenant_id = $1 AND child_id = $2";
      bsParams = [tenantId, childId];
    } else if (tenantId) {
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
    if (tenantId && childId) {
      bcQuery = "SELECT date_key, data FROM bounty_completions WHERE tenant_id = $1 AND child_id = $2";
      bcParams = [tenantId, childId];
    } else if (tenantId) {
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

  async getStats(range: StatsRangeInput, tenantId?: string, childId?: string): Promise<StatsResult> {
    // 快速失败：租户级聚合，缺失 tenantId 时禁止静默退化为跨租户扫描。
    if (!tenantId) {
      throw new Error('tenantId required');
    }

    let rangeMode: StatsRange = 'all';
    let fromOverride: string | undefined;
    let toOverride: string | undefined;
    if (range && typeof range === 'object') {
      rangeMode = range.range || 'all';
      fromOverride = range.from;
      toOverride = range.to;
    } else if (typeof range === 'string') {
      rangeMode = (range as StatsRange) || 'all';
    }

    // 全量 settlement（体积小，用于 allDates / streak / ratingsList / finalPoints）
    const dsQuery = 'SELECT date_key, data FROM daily_settlement WHERE tenant_id = $1 AND child_id = $2';
    const dsResult = await this.pool.query(dsQuery, [tenantId, childId]);
    const settlementByDate: Record<string, any> = {};
    const allDates: string[] = [];
    for (const row of dsResult.rows) {
      const val = this._safeJsonParse(row.data);
      if (val !== undefined) {
        settlementByDate[row.date_key] = val;
        allDates.push(row.date_key);
      }
    }
    allDates.sort();

    // 解析区间（week=末7、month=末30、all=全量；from/to 覆盖）
    let dateRange: string[];
    if (fromOverride && toOverride) {
      dateRange = allDates.filter((d) => d >= fromOverride! && d <= toOverride!);
    } else {
      const maxDays = rangeMode === 'month' ? 30 : rangeMode === 'week' ? 7 : 9999;
      dateRange = maxDays >= 9999 ? allDates : allDates.slice(-maxDays);
    }

    // 区间 homeworks（带日期范围过滤，避免全量下载 —— AC-1）
    const homeworksByDate: Record<string, any[]> = {};
    if (dateRange.length > 0) {
      const from = dateRange[0];
      const to = dateRange[dateRange.length - 1];
      const hwQuery = 'SELECT date_key, data FROM homeworks WHERE tenant_id = $1 AND child_id = $2 AND date_key >= $3 AND date_key <= $4';
      const hwResult = await this.pool.query(hwQuery, [tenantId, childId, from, to]);
      for (const row of hwResult.rows) {
        const items = this._safeJsonParse(row.data);
        if (Array.isArray(items)) {
          homeworksByDate[row.date_key] = items.filter((h: any) => !h.isDeleted);
        }
      }
    }

    return buildStatsFromData({ settlementByDate, homeworksByDate, dateRange, allDates, range: rangeMode });
  }

  // ==================== Bounty Completions Total（对应 GET /api/bounty-completions/total） ====================

  async getBountyCompletionsTotal(tenantId?: string, childId?: string): Promise<Record<string, number>> {
    // 快速失败：缺失 tenantId 时禁止静默退化为跨租户扫描。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const query = 'SELECT date_key, data FROM bounty_completions WHERE tenant_id = $1 AND child_id = $2';
    const result = await this.pool.query(query, [tenantId, childId]);
    const total: Record<string, number> = {};
    // 跳过元数据键（与 admin.js migrateBountyCompletionsToTotal 一致）
    const SKIP_KEYS = new Set(['uuid', 'lastModified', 'isDeleted', '_table', 'date']);
    for (const row of result.rows) {
      const entry = this._safeJsonParse(row.data);
      if (entry && typeof entry === 'object') {
        for (const tid of Object.keys(entry)) {
          if (SKIP_KEYS.has(tid)) continue;
          const v = (entry as Record<string, any>)[tid];
          const delta = typeof v === 'number' ? v : (v ? 1 : 0);
          total[tid] = (total[tid] || 0) + delta;
        }
      }
    }
    return total;
  }

  async importFullData(data: FullDataSnapshot, tenantId?: string, childId?: string): Promise<void> {
    // 快速失败：tenantId 缺失时禁止落库，避免跨租户清空/写入共享行（如 DELETE FROM points_history 无 WHERE）。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const points = data.points ?? {};
    const balance = typeof points === 'number' ? points : (points.balance ?? 0);

    if (tenantId && childId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND child_id = $3 AND id = 1", [balance, tenantId, childId]);
      await this.pool.query("DELETE FROM points_history WHERE tenant_id = $1 AND child_id = $2", [tenantId, childId]);
    } else if (tenantId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [balance, tenantId]);
      await this.pool.query("DELETE FROM points_history WHERE tenant_id = $1", [tenantId]);
    }

    const history = (typeof points === 'object' && points.history) ? points.history : [];
    for (const h of history) {
      if (tenantId && childId) {
        await this.pool.query(
          "INSERT INTO points_history (tenant_id, child_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [tenantId, childId, h.date ?? '', h.earned ?? 0, h.spent ?? 0, h.balance ?? 0, h.detail ?? '']
        );
      } else {
        await this.pool.query(
          "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6)",
          [tenantId, h.date ?? '', h.earned ?? 0, h.spent ?? 0, h.balance ?? 0, h.detail ?? '']
        );
      }
    }

    await this._setJson('badges', data.badges ?? [], tenantId, childId);

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
      const source = (data as unknown as Record<string, unknown>)[sourceKey] ?? defaultValue;
      if (tenantId && childId) {
        await this.pool.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND child_id = $2`, [tenantId, childId]);
      } else if (tenantId) {
        await this.pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
      for (const [dk, v] of Object.entries(source)) {
        if (tenantId && childId) {
          await this.pool.query(
            `INSERT INTO ${table} (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4`,
            [tenantId, childId, dk, JSON.stringify(v)]
          );
        } else if (tenantId) {
          await this.pool.query(
            `INSERT INTO ${table} (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3`,
            [tenantId, dk, JSON.stringify(v)]
          );
        }
      }
    }

    // 单行表（共享表不传 childId，per-child 表传 childId）
    await this._setJson('shop_items', data.shopItems ?? [], tenantId);
    await this._setJson('redemptions', data.redemptions ?? [], tenantId, childId);
    await this._setJson('reward_box', data.rewardBox ?? [], tenantId, childId);
    await this._setJson('settings', data.settings ?? {}, tenantId);
    await this._setJson('active_buffs', data.activeBuffs ?? [], tenantId, childId);
    await this._setJson('bounty_tasks', data.bountyTasks ?? [], tenantId);
  }

  // ==================== Notifications ====================

  async addNotification(text: string, createdAt?: number, tenantId?: string): Promise<string> {
    // 快速失败：通知必须归属到具体租户，禁止落入哨兵 UUID 的共享桶。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const id = crypto.randomUUID();
    const now = createdAt ?? Date.now();
    await this.pool.query(
      'INSERT INTO notifications (tenant_id, id, text, created_at) VALUES ($1, $2, $3, $4)',
      [tenantId, id, text, now]
    );
    // 关键：打版本戳，确保纯发通知也能触发孩子端刷新并播报
    await this.recordModification('notifications', '1', new Date().toISOString(), tenantId);
    return id;
  }

  async getPendingNotifications(tenantId?: string): Promise<NotificationItem[]> {
    // 快速失败：禁止跨全部租户清理/读取通知。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const cutoff = Date.now() - 3600000;
    // 先清理过期通知（限定租户）
    await this.pool.query('DELETE FROM notifications WHERE tenant_id = $1 AND created_at < $2', [tenantId, cutoff]);

    const query = 'SELECT id, text, created_at FROM notifications WHERE tenant_id = $1 AND created_at >= $2 ORDER BY created_at ASC';
    const params = [tenantId, cutoff];
    const result = await this.pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
    }));
  }

  async consumeNotifications(ids: string[], tenantId?: string): Promise<void> {
    // 快速失败：禁止跨全部租户删除通知。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    if (ids.length === 0) return;
    const BATCH_SIZE = 500;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map((_, idx) => `$${idx + 2}`).join(',');
      await this.pool.query(
        `DELETE FROM notifications WHERE tenant_id = $1 AND id IN (${placeholders})`,
        [tenantId, ...batch]
      );
    }
  }

  // ==================== Points ====================

  async getPointsBalance(tenantId?: string, childId?: string): Promise<number> {
    // 快速失败：禁止读取共享 id=1 积分行（跨租户积分泄漏）。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1";
      params = [tenantId, childId];
    } else {
      // tenantId 已确保存在：仅租户维度的积分查询
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      params = [tenantId];
    }
    const result = await this.pool.query(query, params);
    return result.rows[0]?.balance ?? 0;
  }

  async updatePoints(action: 'earn' | 'spend', amount: number, detail: string, tenantId?: string, childId?: string): Promise<number> {
    // 快速失败：禁止读写共享 id=1 积分行（跨租户积分泄漏/篡改）。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1";
      params = [tenantId, childId];
    } else {
      // tenantId 已确保存在：仅租户维度的积分查询
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      params = [tenantId];
    }
    const result = await this.pool.query(query, params);
    let balance = result.rows[0]?.balance ?? 0;

    if (action === 'spend') {
      balance -= amount;
    } else {
      balance += amount;
    }

    if (tenantId && childId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND child_id = $3 AND id = 1", [balance, tenantId, childId]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (tenant_id, child_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [tenantId, childId, today, action === 'earn' ? amount : 0, action === 'spend' ? amount : 0, balance, detail]
      );
    } else {
      // tenantId 已确保存在：仅租户维度的写入
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [balance, tenantId]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6)",
        [tenantId, today, action === 'earn' ? amount : 0, action === 'spend' ? amount : 0, balance, detail]
      );
    }

    // 关键：必须打版本戳，否则孩子端 3s 轮询看不到积分变化而不刷新
    await this.recordModification('points', '1', new Date().toISOString(), tenantId);

    return balance;
  }

  async patchPoints(delta: { earn?: number; spend?: number; detail?: string }, tenantId?: string, childId?: string): Promise<number> {
    // 快速失败：禁止读写共享 id=1 积分行（跨租户积分泄漏/篡改）。
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    let query: string;
    let params: any[];
    if (tenantId && childId) {
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1";
      params = [tenantId, childId];
    } else {
      // tenantId 已确保存在：仅租户维度的积分查询
      query = "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1";
      params = [tenantId];
    }
    const result = await this.pool.query(query, params);
    let balance = result.rows[0]?.balance ?? 0;

    const earned = delta.earn ?? 0;
    const spent = delta.spend ?? 0;
    balance += earned - spent;

    if (tenantId && childId) {
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND child_id = $3 AND id = 1", [balance, tenantId, childId]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (tenant_id, child_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [tenantId, childId, today, earned, spent, balance, delta.detail ?? '']
      );
      await this.recordModification('points', '1', new Date().toISOString(), tenantId);
    } else {
      // tenantId 已确保存在：仅租户维度的写入
      await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [balance, tenantId]);
      const today = new Date().toISOString().slice(0, 10);
      await this.pool.query(
        "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5, $6)",
        [tenantId, today, earned, spent, balance, delta.detail ?? '']
      );
      await this.recordModification('points', '1', new Date().toISOString(), tenantId);
    }

    return balance;
  }

  // ==================== Homeworks ====================

  async getHomeworks(dateKey: string, tenantId?: string, childId?: string): Promise<any[]> {
    return this._getDateData('homeworks', dateKey, [], tenantId, childId);
  }

  async saveHomeworks(dateKey: string, items: HomeworkDTO[], tenantId?: string, childId?: string): Promise<void> {
    await this._setDateData('homeworks', dateKey, items, tenantId, childId);
    await this.recordModification('homeworks', dateKey, new Date().toISOString(), tenantId);
  }

  async moveHomework(fromDate: string, toDate: string, hwId: string, tenantId?: string, childId?: string): Promise<any | null> {
    const fromList = await this._getDateData('homeworks', fromDate, null, tenantId, childId);
    if (!fromList) return null;

    const idx = fromList.findIndex((h: any) => h.id === hwId);
    if (idx === -1) return null;

    const [hw] = fromList.splice(idx, 1);
    await this._setDateData('homeworks', fromDate, fromList, tenantId, childId);

    const toList = await this._getDateData('homeworks', toDate, [], tenantId, childId);
    toList.push(hw);
    await this._setDateData('homeworks', toDate, toList, tenantId, childId);

    const now = new Date().toISOString();
    await this.recordModification('homeworks', fromDate, now, tenantId);
    await this.recordModification('homeworks', toDate, now, tenantId);

    return hw;
  }

  /**
   * 原子地批准「延后作业」：将指定作业从 date 移动到次日（approve 路径）。
   *
   * 并发安全：在单连接事务内，对当天行与次日行分别执行
   * `SELECT ... FOR UPDATE` 行锁，使涉及同一 (tenant, child, date) 乃至
   * (tenant, child, tomorrow) 的并发写串行化，消除原本 read-modify-write
   * 的 TOCTOU 竞态（后写覆盖先写 / deferRequest 丢失）。
   *
   * 适用范围与已知限制（技术债，勿假装已彻底解决）：
   *   - 仅 Postgres 语义有效；当前 createDatabase 仅返回 PostgresAdapter（无 SQLite 分支），
   *     故生产路径下由数据库行锁保证跨连接/多实例互斥。
   *   - 若未来引入 SQLite 兼容模式，行锁不可用，须改用进程内 Mutex 或统一事务层。
   */
  async approveDeferHomework(
    date: string,
    hwId: string,
    tenantId?: string,
    childId?: string,
  ): Promise<{ ok: boolean; homework?: any }> {
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const tomorrow = this._getTomorrow(date);

    return this.withTransaction(async (client) => {
      const hasChild = Boolean(tenantId && childId);

      // 确保 source 与 target 两行均存在，以便都能被行锁锁定。
      // （次日行可能尚不存在；先以空数组 upsert，再 SELECT ... FOR UPDATE 锁住。）
      const ensureSql = hasChild
        ? `INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO NOTHING`
        : `INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO NOTHING`;
      await client.query(ensureSql, hasChild ? [tenantId, childId, date, '[]'] : [tenantId, date, '[]']);
      await client.query(ensureSql, hasChild ? [tenantId, childId, tomorrow, '[]'] : [tenantId, tomorrow, '[]']);

      // 行锁：锁住当天与次日两行，事务提交前其它事务对同一行只能等待。
      const lockSql = hasChild
        ? `SELECT data FROM homeworks WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3 FOR UPDATE`
        : `SELECT data FROM homeworks WHERE tenant_id = $1 AND date_key = $2 FOR UPDATE`;
      const srcParams = hasChild ? [tenantId, childId, date] : [tenantId, date];
      const tgtParams = hasChild ? [tenantId, childId, tomorrow] : [tenantId, tomorrow];

      const srcRes = await client.query(lockSql, srcParams);
      const srcList: any[] = srcRes.rows.length > 0 ? this._safeJsonParse(srcRes.rows[0].data) ?? [] : [];
      const tgtRes = await client.query(lockSql, tgtParams);
      const tgtList: any[] = tgtRes.rows.length > 0 ? this._safeJsonParse(tgtRes.rows[0].data) ?? [] : [];

      // 取 → 改 → 存
      const idx = srcList.findIndex((h: any) => h.id === hwId);
      if (idx === -1) {
        return { ok: false };
      }
      const [hw] = srcList.splice(idx, 1);
      delete hw.deferRequest;
      hw.status = 'pending';
      hw.date = tomorrow;
      tgtList.push(hw);

      const setSql = hasChild
        ? `INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4`
        : `INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3`;
      await client.query(setSql, hasChild ? [tenantId, childId, date, JSON.stringify(srcList)] : [tenantId, date, JSON.stringify(srcList)]);
      await client.query(setSql, hasChild ? [tenantId, childId, tomorrow, JSON.stringify(tgtList)] : [tenantId, tomorrow, JSON.stringify(tgtList)]);

      // 记录变更戳（与 saveHomeworks 行为一致），在事务内完成以保证原子性
      const now = new Date().toISOString();
      await this._recordModificationOnClient(client, 'homeworks', date, now, tenantId);
      await this._recordModificationOnClient(client, 'homeworks', tomorrow, now, tenantId);

      return { ok: true, homework: hw };
    });
  }

  async getHomeworkById(id: string, tenantId?: string, childId?: string): Promise<any | null> {
    const found = await this._findRecordById('homeworks', id, tenantId, childId);
    return found?.item && !found.item.isDeleted ? found.item : null;
  }

  async putHomework(id: string, data: HomeworkDTO, tenantId?: string, childId?: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id, tenantId, childId);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing && !existing.item.isDeleted) {
      const items = await this._getDateDataRaw('homeworks', existing.dateKey, tenantId, childId);
      if (!Array.isArray(items)) {
        await this._setDateData('homeworks', existing.dateKey, [data], tenantId, childId);
        await this.recordModification('homeworks', existing.dateKey, now, tenantId);
        return;
      }
      items[existing.index] = data;
      await this._setDateData('homeworks', existing.dateKey, items, tenantId, childId);
      await this.recordModification('homeworks', existing.dateKey, now, tenantId);
    } else {
      const dateKey = (data.dateKey as string | undefined) ?? (data.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
      let items = await this._getDateDataRaw('homeworks', dateKey, tenantId, childId);
      if (!Array.isArray(items)) {
        items = [];
      }
      items.push(data);
      await this._setDateData('homeworks', dateKey, items, tenantId, childId);
      await this.recordModification('homeworks', dateKey, now, tenantId);
    }
  }

  async patchHomework(id: string, fields: Partial<HomeworkDTO>, tenantId?: string, childId?: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id, tenantId, childId);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = await this._getDateDataRaw('homeworks', existing.dateKey, tenantId, childId);
    items[existing.index] = { ...items[existing.index], ...fields, lastModified: now };
    await this._setDateData('homeworks', existing.dateKey, items, tenantId, childId);
    await this.recordModification('homeworks', existing.dateKey, now, tenantId);
  }

  async deleteHomework(id: string, tenantId?: string, childId?: string): Promise<void> {
    const existing = await this._findRecordById('homeworks', id, tenantId, childId);
    if (!existing) return;

    const now = new Date().toISOString();
    const items = await this._getDateDataRaw('homeworks', existing.dateKey, tenantId, childId);
    items[existing.index].isDeleted = true;
    items[existing.index].lastModified = now;
    await this._setDateData('homeworks', existing.dateKey, items, tenantId, childId);
    await this.recordModification('homeworks', existing.dateKey, now, tenantId);
  }

  // ==================== Settlement ====================

  async getSettlement(dateKey: string, tenantId?: string, childId?: string): Promise<any> {
    return this._getDateData('daily_settlement', dateKey, null, tenantId, childId);
  }

  async saveSettlement(dateKey: string, data: SettlementDTO, tenantId?: string, childId?: string): Promise<void> {
    await this._setDateData('daily_settlement', dateKey, data, tenantId, childId);
    await this.recordModification('daily_settlement', dateKey, new Date().toISOString(), tenantId);
  }

  async putSettlement(dateKey: string, data: SettlementDTO, tenantId?: string, childId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('daily_settlement', dateKey, data, tenantId, childId);
    await this.recordModification('daily_settlement', dateKey, now, tenantId);
  }

  async patchSettlement(dateKey: string, fields: Partial<SettlementDTO>, tenantId?: string, childId?: string): Promise<void> {
    const existing = (await this._getDateDataRaw('daily_settlement', dateKey, tenantId, childId)) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    await this._setDateData('daily_settlement', dateKey, merged, tenantId, childId);
    await this.recordModification('daily_settlement', dateKey, now, tenantId);
  }

  // ==================== Shop ====================

  async getShopItems(tenantId?: string): Promise<any[]> {
    await this._resetDailyShopQuantity(tenantId);
    return (await this._getJson('shop_items', tenantId)) ?? [];
  }

  async saveShopItems(items: ShopItemDTO[], tenantId?: string): Promise<void> {
    await this._setJson('shop_items', items, tenantId);
    await this.recordModification('shop_items', '1', new Date().toISOString(), tenantId);
  }

  async getShopItemById(id: string, tenantId?: string): Promise<any | null> {
    const items = (await this._getJson('shop_items', tenantId)) ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putShopItem(id: string, data: ShopItemDTO, tenantId?: string): Promise<void> {
    const items = (await this._getJson('shop_items', tenantId)) ?? [];
    const { index, item: existingItem } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      if (existingItem?.lastModified && (data.lastModified!) < existingItem.lastModified) {
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

  async getRedemptions(tenantId?: string, childId?: string): Promise<any[]> {
    return (await this._getJson('redemptions', tenantId, childId)) ?? [];
  }

  async saveRedemptions(items: RedemptionDTO[], tenantId?: string, childId?: string): Promise<void> {
    await this._setJson('redemptions', items, tenantId, childId);
    await this.recordModification('redemptions', '1', new Date().toISOString(), tenantId);
  }

  async clearFulfilledRedemptions(tenantId?: string, childId?: string): Promise<void> {
    const items = (await this._getJson('redemptions', tenantId, childId)) ?? [];
    const remaining = items.filter((r: any) => r.status !== 'fulfilled');
    await this._setJson('redemptions', remaining, tenantId, childId);
    await this.recordModification('redemptions', '1', new Date().toISOString(), tenantId);
  }

  async putRedemption(id: string, data: RedemptionDTO, tenantId?: string, childId?: string): Promise<void> {
    const items = (await this._getJson('redemptions', tenantId, childId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('redemptions', items, tenantId, childId);
    await this.recordModification('redemptions', '1', now, tenantId);
  }

  // ==================== Reward Box ====================

  async getRewardBox(tenantId?: string, childId?: string): Promise<any[]> {
    return this._filterDeleted((await this._getJson('reward_box', tenantId, childId))) ?? [];
  }

  async saveRewardBox(items: RewardBoxItemDTO[], tenantId?: string, childId?: string): Promise<void> {
    await this._setJson('reward_box', items, tenantId, childId);
    await this.recordModification('reward_box', '1', new Date().toISOString(), tenantId);
  }

  async putRewardBoxItem(id: string, data: RewardBoxItemDTO, tenantId?: string, childId?: string): Promise<void> {
    const items = (await this._getJson('reward_box', tenantId, childId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('reward_box', items, tenantId, childId);
    await this.recordModification('reward_box', '1', now, tenantId);
  }

  async deleteRewardBoxItem(id: string, tenantId?: string, childId?: string): Promise<void> {
    const items = (await this._getJson('reward_box', tenantId, childId)) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('reward_box', items, tenantId, childId);
    await this.recordModification('reward_box', '1', now, tenantId);
  }

  // ==================== Settings ====================

  async getSettings(tenantId?: string): Promise<any> {
    return (await this._getJson('settings', tenantId)) ?? {};
  }

  async saveSettings(data: SettingsDTO, tenantId?: string): Promise<void> {
    await this._setJson('settings', data, tenantId);
    await this.recordModification('settings', '1', new Date().toISOString(), tenantId);
  }

  async putSettings(data: SettingsDTO, tenantId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setJson('settings', data, tenantId);
    await this.recordModification('settings', '1', now, tenantId);
  }

  async patchSettings(fields: Partial<SettingsDTO>, tenantId?: string): Promise<void> {
    const existing = (await this._getJson('settings', tenantId)) ?? {};
    const now = new Date().toISOString();
    const merged = { ...existing, ...fields, lastModified: now };
    await this._setJson('settings', merged, tenantId);
    await this.recordModification('settings', '1', now, tenantId);
  }

  // ==================== Active Buffs ====================

  async getActiveBuffs(tenantId?: string, childId?: string): Promise<any[]> {
    return (await this._getJson('active_buffs', tenantId, childId)) ?? [];
  }

  async saveActiveBuffs(items: BuffDTO[], tenantId?: string, childId?: string): Promise<void> {
    await this._setJson('active_buffs', items, tenantId, childId);
    await this.recordModification('active_buffs', '1', new Date().toISOString(), tenantId);
  }

  async putBuff(id: string, data: BuffDTO, tenantId?: string, childId?: string): Promise<void> {
    const items = (await this._getJson('active_buffs', tenantId, childId)) ?? [];
    const { index } = this._findInArray(items, id);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }

    await this._setJson('active_buffs', items, tenantId, childId);
    await this.recordModification('active_buffs', '1', now, tenantId);
  }

  async deleteBuff(id: string, tenantId?: string, childId?: string): Promise<void> {
    const items = (await this._getJson('active_buffs', tenantId, childId)) ?? [];
    const { index } = this._findInArray(items, id);
    if (index === -1) return;

    const now = new Date().toISOString();
    items[index].isDeleted = true;
    items[index].lastModified = now;
    await this._setJson('active_buffs', items, tenantId, childId);
    await this.recordModification('active_buffs', '1', now, tenantId);
  }

  // ==================== Efficiency ====================

  async getEfficiency(dateKey: string, tenantId?: string, childId?: string): Promise<any> {
    return this._getDateData('efficiency_history', dateKey, null, tenantId, childId);
  }

  async saveEfficiency(dateKey: string, data: EfficiencyDTO, tenantId?: string, childId?: string): Promise<void> {
    await this._setDateData('efficiency_history', dateKey, data, tenantId, childId);
    await this.recordModification('efficiency_history', dateKey, new Date().toISOString(), tenantId);
  }

  async putEfficiency(dateKey: string, data: EfficiencyDTO, tenantId?: string, childId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('efficiency_history', dateKey, data, tenantId, childId);
    await this.recordModification('efficiency_history', dateKey, now, tenantId);
  }

  // ==================== Free Time ====================

  async getFreeTime(dateKey: string, tenantId?: string, childId?: string): Promise<any[]> {
    return this._getDateData('free_time_tasks', dateKey, [], tenantId, childId);
  }

  async saveFreeTime(dateKey: string, tasks: FreeTimeTaskDTO[], tenantId?: string, childId?: string): Promise<void> {
    await this._setDateData('free_time_tasks', dateKey, tasks, tenantId, childId);
    await this.recordModification('free_time_tasks', dateKey, new Date().toISOString(), tenantId);
  }

  async putFreeTimeTask(id: string, data: FreeTimeTaskDTO, tenantId?: string, childId?: string): Promise<void> {
    const existing = await this._findRecordById('free_time_tasks', id, tenantId, childId);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = await this._getDateDataRaw('free_time_tasks', existing.dateKey, tenantId, childId);
      items[existing.index] = data;
      await this._setDateData('free_time_tasks', existing.dateKey, items, tenantId, childId);
      await this.recordModification('free_time_tasks', existing.dateKey, now, tenantId);
    } else {
      const dateKey = (data.dateKey as string | undefined) ?? (data.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
      const items = (await this._getDateDataRaw('free_time_tasks', dateKey, tenantId, childId)) ?? [];
      items.push(data);
      await this._setDateData('free_time_tasks', dateKey, items, tenantId, childId);
      await this.recordModification('free_time_tasks', dateKey, now, tenantId);
    }
  }

  // ==================== Bounty Tasks ====================

  async getBountyTasks(tenantId?: string): Promise<any[]> {
    return (await this._getJson('bounty_tasks', tenantId)) ?? [];
  }

  async saveBountyTasks(items: BountyTaskDTO[], tenantId?: string): Promise<void> {
    await this._setJson('bounty_tasks', items, tenantId);
    await this.recordModification('bounty_tasks', '1', new Date().toISOString(), tenantId);
  }

  async getBountyTaskById(id: string, tenantId?: string): Promise<any | null> {
    const items = (await this._getJson('bounty_tasks', tenantId)) ?? [];
    const { item } = this._findInArray(items, id);
    return item && !item.isDeleted ? item : null;
  }

  async putBountyTask(id: string, data: BountyTaskDTO, tenantId?: string): Promise<void> {
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

  async getBountySubmissions(dateKey: string, tenantId?: string, childId?: string): Promise<any[]> {
    return this._getDateData('bounty_submissions', dateKey, [], tenantId, childId);
  }

  async saveBountySubmissions(dateKey: string, data: BountySubmissionDTO[], tenantId?: string, childId?: string): Promise<void> {
    await this._setDateData('bounty_submissions', dateKey, data, tenantId, childId);
    await this.recordModification('bounty_submissions', dateKey, new Date().toISOString(), tenantId);
  }

  async putBountySubmission(id: string, data: BountySubmissionDTO, tenantId?: string, childId?: string): Promise<void> {
    const existing = await this._findRecordById('bounty_submissions', id, tenantId, childId);
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;

    if (existing) {
      const items = await this._getDateDataRaw('bounty_submissions', existing.dateKey, tenantId, childId);
      items[existing.index] = data;
      await this._setDateData('bounty_submissions', existing.dateKey, items, tenantId, childId);
      await this.recordModification('bounty_submissions', existing.dateKey, now, tenantId);
    } else {
      const dateKey = (data.dateKey as string | undefined) ?? (data.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
      const items = (await this._getDateDataRaw('bounty_submissions', dateKey, tenantId, childId)) ?? [];
      items.push(data);
      await this._setDateData('bounty_submissions', dateKey, items, tenantId, childId);
      await this.recordModification('bounty_submissions', dateKey, now, tenantId);
    }
  }

  // ==================== Bounty Completions ====================

  async getBountyCompletions(dateKey: string, tenantId?: string, childId?: string): Promise<any> {
    return this._getDateData('bounty_completions', dateKey, {}, tenantId, childId);
  }

  async saveBountyCompletions(dateKey: string, data: BountyCompletionDTO, tenantId?: string, childId?: string): Promise<void> {
    await this._setDateData('bounty_completions', dateKey, data, tenantId, childId);
    await this.recordModification('bounty_completions', dateKey, new Date().toISOString(), tenantId);
  }

  async putBountyCompletion(id: string, data: BountyCompletionDTO, tenantId?: string, childId?: string): Promise<void> {
    const now = new Date().toISOString();
    data.lastModified = data.lastModified ?? now;
    await this._setDateData('bounty_completions', id, data, tenantId, childId);
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

  async saveEmailConfig(config: EmailConfigDTO, tenantId?: string): Promise<void> {
    await this._setJson('email_config', config, tenantId);
    await this.recordModification('email_config', '1', new Date().toISOString(), tenantId);
  }

  // ==================== Sync ====================

  async getModifiedSince(timestamp: string, tenantId?: string, childId?: string): Promise<ModifiedEntry[]> {
    // 快速失败：增量同步为租户级操作，缺失 tenantId 时禁止静默退化为跨租户扫描
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const result = await this.pool.query(
      'SELECT table_name, record_key, last_modified FROM last_modified WHERE tenant_id = $1 AND last_modified > $2',
      [tenantId, timestamp]
    );

    const rows: ModifiedEntry[] = [];

    for (const row of result.rows) {
      const table = row.table_name;
      const recordKey = row.record_key;

      if (table === 'points') {
        let pointsResult: QueryResult;
        if (tenantId && childId) {
          pointsResult = await this.pool.query("SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1", [tenantId, childId]);
        } else {
          pointsResult = await this.pool.query("SELECT balance FROM points WHERE tenant_id = $1 AND id = 1", [tenantId]);
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

      const isShared = SHARED_TABLES.has(table);
      const effectiveChildId = isShared ? undefined : childId;

      let data: any;
      if (DATE_KEY_TABLES.has(table)) {
        data = await this._getDateData(table, recordKey, undefined, tenantId, effectiveChildId);
      } else if (SINGLE_ROW_TABLES.has(table)) {
        data = await this._getJson(table, tenantId, effectiveChildId, parseInt(recordKey, 10));
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

  /**
   * 轻量数据版本戳：MAX(last_modified) 捕获更新，COUNT(*) 捕获新增行。
   * 两者组合可靠地反映租户维度是否有任何数据变更，仅返回几十字节。
   * last_modified 表无 child_id 列，故版本戳为租户级（与 getModifiedSince 的粗粒度一致）。
   */
  async getDataVersion(tenantId?: string): Promise<string | null> {
    // 快速失败：数据版本戳为租户级操作，缺失 tenantId 时禁止静默退化为跨租户聚合
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const result = await this.pool.query(
      'SELECT MAX(last_modified) AS max_ts, COUNT(*)::int AS n FROM last_modified WHERE tenant_id = $1',
      [tenantId]
    );
    const row = result.rows[0];
    if (!row || !row.n) return null;
    return `${row.max_ts}|${row.n}`;
  }

  async pushMerge(changes: any[], tenantId?: string, childId?: string): Promise<{ ok: boolean }> {
    // 快速失败：增量合并为租户级写入，缺失 tenantId 时禁止静默退化为跨租户写入
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    for (const change of changes) {
      const changeType = change.type as string;
      const uuid = change.uuid as string;
      const data = (change.data ?? {}) as any;
      const timestamp = (change.timestamp ?? '') as string;

      if (typeof data !== 'object' || data === null) continue;

      const newLastModified = data.lastModified ?? timestamp;
      const table = this._classifyChange(data);
      if (table === null) continue;

      const isShared = SHARED_TABLES.has(table);
      const effectiveChildId = isShared ? undefined : childId;

      if (table === 'points') {
        const newBalance = data.balance ?? 0;
        if (tenantId && effectiveChildId) {
          await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND child_id = $3 AND id = 1", [newBalance, tenantId, effectiveChildId]);
        } else {
          await this.pool.query("UPDATE points SET balance = $1 WHERE tenant_id = $2 AND id = 1", [newBalance, tenantId]);
        }
        await this.recordModification('points', '1', timestamp, tenantId);
        continue;
      }

      if (DATE_KEY_TABLES.has(table)) {
        const recordKey = data.date || data.dateKey || uuid || '';
        if (!recordKey) continue;

        const existing = await this._getDateDataRaw(table, recordKey, tenantId, effectiveChildId);
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

          await this._setDateData(table, recordKey, existingList, tenantId, effectiveChildId);
          await this.recordModification(table, recordKey, timestamp, tenantId);
        } else if (existingDict !== null) {
          const oldLast = existingDict.lastModified ?? '0';
          if (changeType === 'delete') {
            data.isDeleted = true;
            await this._setDateData(table, recordKey, data, tenantId, effectiveChildId);
          } else if (newLastModified >= oldLast) {
            await this._setDateData(table, recordKey, data, tenantId, effectiveChildId);
          }
          await this.recordModification(table, recordKey, timestamp, tenantId);
        }
      } else if (SINGLE_ROW_TABLES.has(table)) {
        const existing = await this._getJson(table, tenantId, effectiveChildId, 1);
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
          await this._setJson(table, existingList, tenantId, effectiveChildId, 1);
          await this.recordModification(table, '1', timestamp, tenantId);
        } else if (existingDict) {
          await this._setJson(table, data, tenantId, effectiveChildId, 1);
          await this.recordModification(table, '1', timestamp, tenantId);
        }
      }
    }

    return { ok: true };
  }

  // ==================== Sync ====================

  async recordModification(tableName: string, recordKey: string, timestamp: string, tenantId?: string): Promise<void> {
    // 快速失败：变更追踪为租户级写入，缺失 tenantId 时禁止写入无租户归属的 last_modified 行
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    await this.pool.query(
      'INSERT INTO last_modified (tenant_id, table_name, record_key, last_modified) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, table_name, record_key) DO UPDATE SET last_modified = $4',
      [tenantId, tableName, recordKey, timestamp]
    );
  }

  // ==================== Misc ====================

  async resetDate(dateKey: string, tenantId?: string, childId?: string): Promise<void> {
    // 快速失败：按租户重置日期数据为租户级操作，缺失 tenantId 时禁止静默退化为跨租户清空
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    if (childId) {
      await this.pool.query("DELETE FROM homeworks WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3", [tenantId, childId, dateKey]);
      await this.pool.query("DELETE FROM daily_settlement WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3", [tenantId, childId, dateKey]);
      await this.pool.query("DELETE FROM efficiency_history WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3", [tenantId, childId, dateKey]);
      await this.pool.query("DELETE FROM free_time_tasks WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3", [tenantId, childId, dateKey]);
      await this.pool.query("DELETE FROM bounty_submissions WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3", [tenantId, childId, dateKey]);
      await this.pool.query("DELETE FROM bounty_completions WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3", [tenantId, childId, dateKey]);
    } else {
      await this.pool.query("DELETE FROM homeworks WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
      await this.pool.query("DELETE FROM daily_settlement WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
      await this.pool.query("DELETE FROM efficiency_history WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
      await this.pool.query("DELETE FROM free_time_tasks WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
      await this.pool.query("DELETE FROM bounty_submissions WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
      await this.pool.query("DELETE FROM bounty_completions WHERE tenant_id = $1 AND date_key = $2", [tenantId, dateKey]);
    }

    // 清理与当日相关的 active_buffs
    const buffs = (await this._getJson('active_buffs', tenantId, childId)) ?? [];
    const beforeCount = buffs.length;
    const parts = dateKey.split('-');
    if (parts.length !== 3) return;
    const isoPrefix = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    const filteredBuffs = buffs.filter((b: any) =>
      b.startDate !== dateKey && !b.startDate?.startsWith(isoPrefix)
    );
    if (filteredBuffs.length !== beforeCount) {
      await this._setJson('active_buffs', filteredBuffs, tenantId, childId);
    }

    // tenantId 已确保存在：仅清理该租户的 last_shop_reset 标记
    await this.pool.query("DELETE FROM meta WHERE tenant_id = $1 AND key = 'last_shop_reset'", [tenantId]);
  }

  // ==================== CRDT Operations ====================

  async hasCRDTOperation(id: string, tenantId?: string): Promise<boolean> {
    // 快速失败：CRDT 操作为租户级，缺失 tenantId 时禁止静默退化为跨租户查询
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const result = await this.pool.query(
      'SELECT 1 FROM crdt_operations WHERE tenant_id = $1 AND id = $2',
      [tenantId, id]
    );
    return result.rows.length > 0;
  }

  async saveCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void> {
    // 快速失败：CRDT 操作为租户级写入，缺失 tenantId 时禁止静默退化为无租户归属写入
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    await this.pool.query(
      `INSERT INTO crdt_operations (tenant_id, id, type, table_name, resource_id, field, value, timestamp, node_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         type = $3, table_name = $4, resource_id = $5, field = $6,
         value = $7, timestamp = $8, node_id = $9`,
      [tenantId, op.id, op.type, op.table, op.resourceId, op.field, JSON.stringify(op.value), op.timestamp, op.nodeId]
    );
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
              await this.patchHomework(op.resourceId, op.value as Record<string, unknown>, tenantId);
            } else {
              await this.putHomework(op.resourceId, op.value as HomeworkDTO, tenantId);
            }
            break;
          }
          case 'shop_items': await this.putShopItem(op.resourceId, op.value as ShopItemDTO, tenantId); break;
          case 'bounty_tasks': await this.putBountyTask(op.resourceId, op.value as BountyTaskDTO, tenantId); break;
          case 'bounty_submissions': await this.putBountySubmission(op.resourceId, op.value as BountySubmissionDTO, tenantId); break;
          case 'bounty_completions': await this.putBountyCompletion(op.resourceId, op.value as BountyCompletionDTO, tenantId); break;
          case 'redemptions': await this.putRedemption(op.resourceId, op.value as RedemptionDTO, tenantId); break;
          case 'reward_box': await this.putRewardBoxItem(op.resourceId, op.value as RewardBoxItemDTO, tenantId); break;
          case 'active_buffs': await this.putBuff(op.resourceId, op.value as BuffDTO, tenantId); break;
          case 'free_time_tasks': await this.putFreeTimeTask(op.resourceId, op.value as FreeTimeTaskDTO, tenantId); break;
          case 'daily_settlement': await this.putSettlement(op.resourceId, op.value as SettlementDTO, tenantId); break;
          case 'settings': await this.putSettings(op.value as SettingsDTO, tenantId); break;
          case 'notifications':
            await this.addNotification((op.value as { text: string; createdAt: number }).text, (op.value as { text: string; createdAt: number }).createdAt, tenantId);
            break;
        }
      }
    } catch (e) {
      console.error('Failed to apply CRDT operation', op, e);
    }
  }

  async getCRDTOperationsSince(timestamp: string, tenantId?: string): Promise<CRDTOperation[]> {
    // 快速失败：CRDT 拉取为租户级，缺失 tenantId 时禁止静默退化为跨租户读取
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    const result = await this.pool.query(
      'SELECT * FROM crdt_operations WHERE tenant_id = $1 AND timestamp > $2 ORDER BY timestamp ASC',
      [tenantId, timestamp]
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

  async ackCRDTOperations(timestamp: string, tenantId?: string): Promise<void> {
    // 快速失败：CRDT 确认为租户级清理，缺失 tenantId 时禁止静默退化为跨租户清空
    if (!tenantId) {
      throw new Error('tenantId required');
    }
    await this.pool.query(
      'DELETE FROM crdt_operations WHERE tenant_id = $1 AND timestamp <= $2',
      [tenantId, timestamp]
    );
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
          is_super_admin: row.is_super_admin ?? false,
          needs_password_change: row.needs_password_change ?? false,
          created_at: row.created_at,
          last_login: row.last_login ?? undefined,
        };
      }
    }
    return null;
  }

  async findUserByAccessCode(accessCode: string): Promise<any | null> {
    const row = await this.pool.query(
      'SELECT * FROM users WHERE access_code = $1 AND is_active = true LIMIT 1',
      [accessCode]
    ).then(r => r.rows[0]);
    if (!row) return null;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      role: row.role,
      nickname: row.nickname,
      access_hash: row.access_hash,
      token_version: row.token_version,
      is_active: row.is_active,
      is_super_admin: row.is_super_admin ?? false,
      needs_password_change: row.needs_password_change ?? false,
      created_at: row.created_at,
      last_login: row.last_login ?? undefined,
    };
  }

  async getUserById(userId: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT id, role, email, password_hash, family_name, first_login, token_version, is_active, is_super_admin, needs_password_change, created_at, last_login FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      role: row.role,
      email: row.email,
      password_hash: row.password_hash,
      family_name: row.family_name,
      first_login: row.first_login,
      token_version: row.token_version,
      is_active: row.is_active,
      is_super_admin: row.is_super_admin ?? false,
      needs_password_change: row.needs_password_change ?? false,
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

  async deleteTenant(id: string): Promise<void> {
    await this.pool.query('DELETE FROM tenants WHERE id = $1', [id]);
  }

  async createUser(input: any): Promise<void> {
    const { id, role, email, password_hash, family_name, tenant_id, token_version } = input;
    await this.pool.query(
      'INSERT INTO users (id, role, email, password_hash, family_name, tenant_id, token_version, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, true) ON CONFLICT (id) DO NOTHING',
      [id, role, email ?? null, password_hash ?? null, family_name ?? null, tenant_id ?? null, token_version ?? 1]
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

  async findAdminExists(): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM users WHERE role = $1 AND is_active = $2 LIMIT 1',
      ['admin', true]
    );
    return result.rows.length > 0;
  }

  async findUserByEmail(email: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT id, role, email, password_hash, token_version, family_name, first_login, is_active FROM users WHERE email = $1 AND is_active = true LIMIT 1',
      [email]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async getTenantMembers(tenantId: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT ac.id, ac.tenant_id, ac.code_hash as access_hash, ac.created_at, ch.name as nickname FROM access_codes ac LEFT JOIN children ch ON ch.id = ac.child_id WHERE ac.tenant_id = $1 ORDER BY ac.created_at ASC',
      [tenantId]
    );
    return result.rows;
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

  async findSuperAdmin(username: string): Promise<AdminUser | null> {
    const result = await this.pool.query(
      'SELECT id, role, email, password_hash, token_version, first_login FROM users WHERE email = $1 AND role = $2 AND is_active = true LIMIT 1',
      [username, 'admin']
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenant_id: row.id,
      email: row.email,
      password_hash: row.password_hash,
      token_version: row.token_version,
    };
  }

  async updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET email = $1, password_hash = $2, first_login = false, token_version = token_version + 1 WHERE id = $3',
      [email, passwordHash, userId]
    );
  }

  async getAllTenants(): Promise<TenantListItem[]> {
    const result = await this.pool.query(`
      SELECT u.id, u.family_name AS name, u.is_active, u.created_at,
        (SELECT COUNT(*) FROM access_codes a WHERE a.tenant_id = u.id) AS member_count
      FROM users u
      WHERE u.role = 'user'
      ORDER BY u.created_at ASC
    `);
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      member_count: parseInt(row.member_count, 10) || 0,
      is_active: !!row.is_active,
      created_at: row.created_at,
    }));
  }

  async setTenantActive(tenantId: string, isActive: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE users SET is_active = $2 WHERE id = $1 AND role = $3',
      [tenantId, isActive, 'user']
    );
  }

  // ==================== Access Codes ====================

  async createAccessCode(input: CreateAccessCodeInput): Promise<string> {
    // 防御性 INSERT：显式补列，规避生产库 access_codes 表 created_at / token_version
    // 可能为 NOT NULL 且无 DB 默认值导致插入失败（-> 500）。
    await this.pool.query(
      'INSERT INTO access_codes (id, tenant_id, code_hash, access_code, child_id, created_at, token_version) VALUES ($1, $2, $3, $4, $5, NOW(), 1)',
      [input.id, input.tenant_id, input.code_hash, input.access_code ?? null, input.child_id]
    );
    return input.id;
  }

  async getAccessCodesByUser(tenantId: string): Promise<AccessCodeRecord[]> {
    const result = await this.pool.query(
      'SELECT id, tenant_id, code_hash, access_code, child_id, token_version, last_login, created_at FROM access_codes WHERE tenant_id = $1 ORDER BY created_at ASC',
      [tenantId]
    );
    return result.rows.map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      code_hash: r.code_hash,
      access_code: r.access_code ?? undefined,
      child_id: r.child_id,
      token_version: r.token_version ?? 1,
      last_login: r.last_login ? (typeof r.last_login === 'object' ? r.last_login.toISOString() : r.last_login) : undefined,
      created_at: typeof r.created_at === 'object' ? r.created_at.toISOString() : r.created_at,
    }));
  }

  async findAccessCodeByCode(code: string): Promise<AccessCodeRecord | null> {
    const result = await this.pool.query('SELECT * FROM access_codes');
    for (const row of result.rows) {
      if (bcrypt.compareSync(code, row.code_hash)) {
        return {
          id: row.id,
          tenant_id: row.tenant_id,
          code_hash: row.code_hash,
          access_code: row.access_code ?? undefined,
          child_id: row.child_id,
          token_version: row.token_version ?? 1,
          last_login: row.last_login ? (typeof row.last_login === 'object' ? row.last_login.toISOString() : row.last_login) : undefined,
          created_at: typeof row.created_at === 'object' ? row.created_at.toISOString() : row.created_at,
        };
      }
    }
    return null;
  }

  async getAccessCodeById(id: string): Promise<AccessCodeRecord | null> {
    const result = await this.pool.query('SELECT * FROM access_codes WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      code_hash: row.code_hash,
      access_code: row.access_code ?? undefined,
      child_id: row.child_id,
      token_version: row.token_version ?? 1,
      last_login: row.last_login ? (typeof row.last_login === 'object' ? row.last_login.toISOString() : row.last_login) : undefined,
      created_at: typeof row.created_at === 'object' ? row.created_at.toISOString() : row.created_at,
    };
  }

  async updateAccessCodeLastLogin(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE access_codes SET last_login = NOW() WHERE id = $1",
      [id]
    );
  }

  async regenerateAccessCode(id: string, tenantId: string): Promise<string> {
    const { raw, hashed } = await generateAccessHash();
    const result = await this.pool.query(
      'UPDATE access_codes SET code_hash = $1, access_code = $2, token_version = token_version + 1 WHERE id = $3 AND tenant_id = $4',
      [hashed, raw, id, tenantId]
    );
    if (result.rowCount === 0) throw new Error('访问码不存在或不属于该用户');
    return raw;
  }

  async deleteAccessCode(id: string, tenantId: string): Promise<void> {
    await this.pool.query('DELETE FROM access_codes WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  }

  // ==================== Children ====================

  async createChild(tenantId: string, name: string, accessCodeId?: string): Promise<ChildrenRecord> {
    const id = crypto.randomUUID();
    // 防御性 INSERT：显式补列，规避生产库 children 表 created_at / is_active / avatar
    // 可能为 NOT NULL 且无 DB 默认值导致插入失败（-> 500）。
    await this.pool.query(
      "INSERT INTO children (id, tenant_id, name, access_code_id, created_at, is_active, avatar) VALUES ($1, $2, $3, $4, NOW(), true, NULL)",
      [id, tenantId, name, accessCodeId ?? null]
    );
    return { id, tenant_id: tenantId, name, access_code_id: accessCodeId ?? undefined, is_active: true, created_at: new Date().toISOString() };
  }

  async getChildById(id: string, tenantId: string): Promise<ChildrenRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM children WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this._mapChildRow(result.rows[0]);
  }

  async getChildrenByTenant(tenantId: string, activeOnly = true): Promise<ChildrenRecord[]> {
    const query = activeOnly
      ? 'SELECT * FROM children WHERE tenant_id = $1 AND is_active = true ORDER BY created_at'
      : 'SELECT * FROM children WHERE tenant_id = $1 ORDER BY created_at';
    const result = await this.pool.query(query, [tenantId]);
    return result.rows.map(row => this._mapChildRow(row));
  }

  async updateChild(id: string, tenantId: string, fields: { name?: string; is_active?: boolean; access_code_id?: string | null }): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (fields.name !== undefined) { sets.push(`name = $${idx++}`); params.push(fields.name); }
    if (fields.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(fields.is_active); }
    if (fields.access_code_id !== undefined) { sets.push(`access_code_id = $${idx++}`); params.push(fields.access_code_id); }
    if (sets.length === 0) return;
    params.push(id, tenantId);
    await this.pool.query(
      `UPDATE children SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}`,
      params
    );
  }

  async findChildByAccessCodeId(accessCodeId: string, tenantId: string): Promise<ChildrenRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM children WHERE access_code_id = $1 AND tenant_id = $2',
      [accessCodeId, tenantId]
    );
    if (result.rows.length === 0) return null;
    return this._mapChildRow(result.rows[0]);
  }

  async assignLegacyDataToChild(tenantId: string, childId: string): Promise<void> {
    const perChildTables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks', 'bounty_submissions', 'bounty_completions', 'points', 'points_history', 'redemptions', 'reward_box', 'active_buffs', 'badges'];
    for (const table of perChildTables) {
      await this.pool.query(`UPDATE ${table} SET child_id = $1 WHERE tenant_id = $2 AND child_id IS NULL`, [childId, tenantId]);
    }
  }

  private _mapChildRow(row: any): ChildrenRecord {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      avatar: row.avatar ?? undefined,
      access_code_id: row.access_code_id ?? undefined,
      is_active: row.is_active ?? true,
      created_at: typeof row.created_at === 'object' ? row.created_at.toISOString() : row.created_at,
    };
  }

  // ==================== Ops Methods ====================

  async insertBackupRecord(record: BackupRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO backup_records (id, filename, size_bytes, status, error_message, checksum, created_at, triggered_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [record.id, record.filename, record.size_bytes, record.status, record.error_message, record.checksum, record.created_at, record.triggered_by]
    );
  }

  async listBackupRecords(limit: number): Promise<BackupRecord[]> {
    const result = await this.pool.query('SELECT * FROM backup_records ORDER BY created_at DESC LIMIT $1', [limit]);
    return result.rows;
  }

  async getBackupRecord(id: string): Promise<BackupRecord | null> {
    const result = await this.pool.query('SELECT * FROM backup_records WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async deleteBackupRecord(id: string): Promise<void> {
    await this.pool.query('DELETE FROM backup_records WHERE id = $1', [id]);
  }

  async deleteBackupRecordsOlderThan(count: number): Promise<BackupRecord[]> {
    const all = await this.pool.query('SELECT * FROM backup_records WHERE status = $1 ORDER BY created_at DESC', ['success']);
    if (all.rows.length <= count) return [];
    const toDelete = all.rows.slice(count);
    for (const r of toDelete) {
      await this.pool.query('DELETE FROM backup_records WHERE id = $1', [r.id]);
    }
    return toDelete;
  }

  async getLatestBackupRecord(): Promise<BackupRecord | null> {
    const result = await this.pool.query('SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 1');
    return result.rows[0] ?? null;
  }

  async insertHealthRecord(record: HealthRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO health_records (id, created_at, event_type, alert_key, severity, snapshot_json, message) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.id, record.created_at, record.event_type, record.alert_key, record.severity, record.snapshot_json, record.message]
    );
  }

  async listHealthRecords(limit: number): Promise<HealthRecord[]> {
    const result = await this.pool.query('SELECT * FROM health_records ORDER BY created_at DESC LIMIT $1', [limit]);
    return result.rows;
  }

  async pruneHealthRecords(maxRows: number): Promise<void> {
    await this.pool.query(
      `DELETE FROM health_records WHERE id IN (SELECT id FROM health_records ORDER BY created_at ASC LIMIT GREATEST(0, (SELECT COUNT(*) FROM health_records) - $1))`,
      [maxRows]
    );
  }

  async getAlertState(key: string): Promise<AlertState | null> {
    const result = await this.pool.query('SELECT * FROM alert_state WHERE alert_key = $1', [key]);
    return result.rows[0] ?? null;
  }

  async upsertAlertState(state: AlertState): Promise<void> {
    await this.pool.query(
      `INSERT INTO alert_state (alert_key, status, last_notified_at, first_triggered_at, severity, message) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (alert_key) DO UPDATE SET status = $2, last_notified_at = $3, first_triggered_at = $4, severity = $5, message = $6`,
      [state.alert_key, state.status, state.last_notified_at, state.first_triggered_at, state.severity, state.message]
    );
  }

  async getOpsConfig(): Promise<OpsConfig | null> {
    const tenantResult = await this.pool.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1');
    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) return null;
    const result = await this.pool.query('SELECT data FROM settings WHERE tenant_id = $1', [tenantId]);
    if (!result.rows[0]) return null;
    const data = typeof result.rows[0].data === 'string' ? JSON.parse(result.rows[0].data) : result.rows[0].data;
    return data?.ops_config ?? null;
  }

  async saveOpsConfig(config: OpsConfig): Promise<void> {
    const tenantResult = await this.pool.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1');
    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) return;
    const settingsResult = await this.pool.query('SELECT data FROM settings WHERE tenant_id = $1', [tenantId]);
    let data: any = {};
    if (settingsResult.rows[0]) {
      data = typeof settingsResult.rows[0].data === 'string' ? JSON.parse(settingsResult.rows[0].data) : settingsResult.rows[0].data;
    }
    data.ops_config = config;
    await this.pool.query(
      `INSERT INTO settings (tenant_id, id, data) VALUES ($1, 1, $2)
       ON CONFLICT (tenant_id, id) DO UPDATE SET data = $2`,
      [tenantId, JSON.stringify(data)]
    );
  }

  // ==================== Connection ====================

  async close(): Promise<void> {
    await this.pool.end();
  }
}

async function generateAccessHash(): Promise<{ raw: string; hashed: string }> {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let raw = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const hashed = await bcrypt.hash(raw, 10);
  return { raw, hashed };
}
