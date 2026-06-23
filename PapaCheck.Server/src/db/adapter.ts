import type { BackupRecord, HealthRecord, AlertState, OpsConfig } from './types.js';

export type { IDatabase } from './interfaces/index.js';

// ==================== DatabaseAdapter 抽象基类 ====================

export abstract class DatabaseAdapter {
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

}