import type { IDatabase, FullDataSnapshot, ModifiedEntry, NotificationItem, ChildrenRecord, AccessCodeRecord, CreateAccessCodeInput, TenantListItem, BackupRecord, HealthRecord, AlertState, OpsConfig } from './types.js';
import type { CRDTOperation } from '../crdt/types.js';

// ==================== DatabaseAdapter 抽象基类 ====================

export abstract class DatabaseAdapter implements IDatabase {
  // ==================== Utility Methods ====================

  protected _safeJsonParse(data: string): any | undefined {
    try {
      const val = JSON.parse(data);
      return val !== null && val !== undefined ? val : undefined;
    } catch {
      return undefined;
    }
  }

  protected _findByUuid(items: any[], uuid: string): { index: number; item: any } {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.uuid === uuid || item?.id === uuid || item?.taskId === uuid) {
        return { index: i, item };
      }
    }
    return { index: -1, item: null };
  }

  _findInArray(data: any[], id: string): { index: number; item: any } {
    return this._findByUuid(data, id);
  }

  protected _filterDeleted(data: any): any {
    if (Array.isArray(data)) {
      return data.filter((item: any) => !item.isDeleted);
    }
    return data;
  }

  protected _classifyChange(data: any): string | null {
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

  // ==================== Ops Methods (default stubs) ====================
  async insertBackupRecord(_record: BackupRecord): Promise<void> { throw new Error('Not implemented'); }
  async listBackupRecords(_limit: number): Promise<BackupRecord[]> { throw new Error('Not implemented'); }
  async getBackupRecord(_id: string): Promise<BackupRecord | null> { throw new Error('Not implemented'); }
  async deleteBackupRecord(_id: string): Promise<void> { throw new Error('Not implemented'); }
  async deleteBackupRecordsOlderThan(_count: number): Promise<BackupRecord[]> { throw new Error('Not implemented'); }
  async getLatestBackupRecord(): Promise<BackupRecord | null> { throw new Error('Not implemented'); }
  async insertHealthRecord(_record: HealthRecord): Promise<void> { throw new Error('Not implemented'); }
  async listHealthRecords(_limit: number): Promise<HealthRecord[]> { throw new Error('Not implemented'); }
  async pruneHealthRecords(_maxRows: number): Promise<void> { throw new Error('Not implemented'); }
  async getAlertState(_key: string): Promise<AlertState | null> { throw new Error('Not implemented'); }
  async upsertAlertState(_state: AlertState): Promise<void> { throw new Error('Not implemented'); }
  async getOpsConfig(): Promise<OpsConfig | null> { throw new Error('Not implemented'); }
  async saveOpsConfig(_config: OpsConfig): Promise<void> { throw new Error('Not implemented'); }

  // ==================== Abstract Methods ====================

  abstract close(): Promise<void>;
  abstract getFullData(tenantId?: string, childId?: string): Promise<FullDataSnapshot>;
  abstract importFullData(data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract addNotification(text: string, createdAt?: number, tenantId?: string): Promise<string>;
  abstract getPendingNotifications(tenantId?: string): Promise<NotificationItem[]>;
  abstract consumeNotifications(ids: string[], tenantId?: string): Promise<void>;
  abstract getPointsBalance(tenantId?: string, childId?: string): Promise<number>;
  abstract updatePoints(action: 'earn' | 'spend', amount: number, detail: string, tenantId?: string, childId?: string): Promise<number>;
  abstract patchPoints(delta: { earn?: number; spend?: number; detail?: string }, tenantId?: string, childId?: string): Promise<number>;
  abstract getHomeworks(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  abstract saveHomeworks(dateKey: string, items: any[], tenantId?: string, childId?: string): Promise<void>;
  abstract moveHomework(fromDate: string, toDate: string, hwId: string, tenantId?: string, childId?: string): Promise<any | null>;
  abstract getHomeworkById(id: string, tenantId?: string, childId?: string): Promise<any | null>;
  abstract putHomework(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract patchHomework(id: string, fields: any, tenantId?: string, childId?: string): Promise<void>;
  abstract deleteHomework(id: string, tenantId?: string, childId?: string): Promise<void>;
  abstract getSettlement(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  abstract saveSettlement(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract putSettlement(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract patchSettlement(dateKey: string, fields: any, tenantId?: string, childId?: string): Promise<void>;
  abstract getShopItems(tenantId?: string): Promise<any[]>;
  abstract saveShopItems(items: any[], tenantId?: string): Promise<void>;
  abstract getShopItemById(id: string, tenantId?: string): Promise<any | null>;
  abstract putShopItem(id: string, data: any, tenantId?: string): Promise<void>;
  abstract deleteShopItem(id: string, tenantId?: string): Promise<void>;
  abstract getRedemptions(tenantId?: string, childId?: string): Promise<any[]>;
  abstract saveRedemptions(items: any[], tenantId?: string, childId?: string): Promise<void>;
  abstract clearFulfilledRedemptions(tenantId?: string, childId?: string): Promise<void>;
  abstract putRedemption(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract getRewardBox(tenantId?: string, childId?: string): Promise<any[]>;
  abstract saveRewardBox(items: any[], tenantId?: string, childId?: string): Promise<void>;
  abstract putRewardBoxItem(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract deleteRewardBoxItem(id: string, tenantId?: string, childId?: string): Promise<void>;
  abstract getSettings(tenantId?: string): Promise<any>;
  abstract saveSettings(data: any, tenantId?: string): Promise<void>;
  abstract putSettings(data: any, tenantId?: string): Promise<void>;
  abstract patchSettings(fields: any, tenantId?: string): Promise<void>;
  abstract getActiveBuffs(tenantId?: string, childId?: string): Promise<any[]>;
  abstract saveActiveBuffs(items: any[], tenantId?: string, childId?: string): Promise<void>;
  abstract putBuff(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract deleteBuff(id: string, tenantId?: string, childId?: string): Promise<void>;
  abstract getEfficiency(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  abstract saveEfficiency(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract putEfficiency(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract getFreeTime(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  abstract saveFreeTime(dateKey: string, tasks: any[], tenantId?: string, childId?: string): Promise<void>;
  abstract putFreeTimeTask(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract getBountyTasks(tenantId?: string): Promise<any[]>;
  abstract saveBountyTasks(items: any[], tenantId?: string): Promise<void>;
  abstract getBountyTaskById(id: string, tenantId?: string): Promise<any | null>;
  abstract putBountyTask(id: string, data: any, tenantId?: string): Promise<void>;
  abstract deleteBountyTask(id: string, tenantId?: string): Promise<void>;
  abstract getBountySubmissions(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  abstract saveBountySubmissions(dateKey: string, data: any[], tenantId?: string, childId?: string): Promise<void>;
  abstract putBountySubmission(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract getBountyCompletions(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  abstract saveBountyCompletions(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract putBountyCompletion(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  abstract getEmailConfig(tenantId?: string): Promise<any | null>;
  abstract saveEmailConfig(config: any, tenantId?: string): Promise<void>;
  abstract getModifiedSince(timestamp: string, tenantId?: string, childId?: string): Promise<ModifiedEntry[]>;
  abstract pushMerge(changes: any[], tenantId?: string, childId?: string): Promise<{ ok: boolean }>;
  abstract recordModification(tableName: string, recordKey: string, timestamp: string, tenantId?: string): Promise<void>;
  abstract resetDate(dateKey: string, tenantId?: string, childId?: string): Promise<void>;
  abstract saveCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  abstract hasCRDTOperation(id: string, tenantId?: string): Promise<boolean>;
  abstract applyCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  abstract getCRDTOperationsSince(timestamp: string, tenantId?: string): Promise<CRDTOperation[]>;
  abstract ackCRDTOperations(timestamp: string, tenantId?: string): Promise<void>;
  abstract queryUserTokenVersion(userId: string): Promise<number>;
  abstract getUserById(userId: string): Promise<any | null>;
  abstract updateUserLastLogin(userId: string): Promise<void>;
  abstract updateAccessCodeLastLogin(id: string): Promise<void>;
  abstract createUser(input: any): Promise<void>;
  abstract findAdminByEmail(email: string): Promise<any | null>;
  abstract findAdminExists(): Promise<boolean>;
  abstract findUserByEmail(email: string): Promise<any | null>;
  abstract findUserByAccessHash(accessHash: string): Promise<any | null>;
  abstract findUserByAccessCode(accessCode: string): Promise<any | null>;
  abstract updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<void>;

  // Tenants
  abstract getAllTenants(): Promise<TenantListItem[]>;
  abstract setTenantActive(tenantId: string, isActive: boolean): Promise<void>;
  abstract createTenant(id: string, name: string): Promise<void>;

  // Access Codes
  abstract createAccessCode(input: CreateAccessCodeInput): Promise<string>;
  abstract getAccessCodesByUser(userId: string): Promise<AccessCodeRecord[]>;
  abstract findAccessCodeByCode(code: string): Promise<AccessCodeRecord | null>;
  abstract getAccessCodeById(id: string): Promise<AccessCodeRecord | null>;
  abstract regenerateAccessCode(id: string, userId: string): Promise<string>;
  abstract deleteAccessCode(id: string, userId: string): Promise<void>;

  // Children
  abstract createChild(tenantId: string, name: string, accessCodeId?: string): Promise<ChildrenRecord>;
  abstract getChildById(id: string, tenantId: string): Promise<ChildrenRecord | null>;
  abstract getChildrenByTenant(tenantId: string, activeOnly?: boolean): Promise<ChildrenRecord[]>;
  abstract updateChild(id: string, tenantId: string, fields: { name?: string; is_active?: boolean; access_code_id?: string | null }): Promise<void>;
  abstract findChildByAccessCodeId(accessCodeId: string, tenantId: string): Promise<ChildrenRecord | null>;
  abstract assignLegacyDataToChild(tenantId: string, childId: string): Promise<void>;
}