import type { IDatabase, FullDataSnapshot, ModifiedEntry, NotificationItem } from './types.js';
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

  /** 在数组中按 id/uuid/taskId 查找（通用方法） */
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

  // ==================== Abstract Methods ====================

  abstract close(): Promise<void>;
  abstract getFullData(): Promise<FullDataSnapshot>;
  abstract importFullData(data: any): Promise<void>;
  abstract addNotification(text: string, createdAt?: number): Promise<string>;
  abstract getPendingNotifications(): Promise<NotificationItem[]>;
  abstract consumeNotifications(ids: string[]): Promise<void>;
  abstract getPointsBalance(): Promise<number>;
  abstract updatePoints(action: 'earn' | 'spend', amount: number, detail: string): Promise<number>;
  abstract patchPoints(delta: { earn?: number; spend?: number; detail?: string }): Promise<number>;
  abstract getHomeworks(dateKey: string): Promise<any[]>;
  abstract saveHomeworks(dateKey: string, items: any[]): Promise<void>;
  abstract moveHomework(fromDate: string, toDate: string, hwId: string): Promise<any | null>;
  abstract getHomeworkById(id: string): Promise<any | null>;
  abstract putHomework(id: string, data: any): Promise<void>;
  abstract patchHomework(id: string, fields: any): Promise<void>;
  abstract deleteHomework(id: string): Promise<void>;
  abstract getSettlement(dateKey: string): Promise<any>;
  abstract saveSettlement(dateKey: string, data: any): Promise<void>;
  abstract putSettlement(dateKey: string, data: any): Promise<void>;
  abstract patchSettlement(dateKey: string, fields: any): Promise<void>;
  abstract getShopItems(): Promise<any[]>;
  abstract saveShopItems(items: any[]): Promise<void>;
  abstract getShopItemById(id: string): Promise<any | null>;
  abstract putShopItem(id: string, data: any): Promise<void>;
  abstract deleteShopItem(id: string): Promise<void>;
  abstract getRedemptions(): Promise<any[]>;
  abstract saveRedemptions(items: any[]): Promise<void>;
  abstract clearFulfilledRedemptions(): Promise<void>;
  abstract putRedemption(id: string, data: any): Promise<void>;
  abstract getRewardBox(): Promise<any[]>;
  abstract saveRewardBox(items: any[]): Promise<void>;
  abstract putRewardBoxItem(id: string, data: any): Promise<void>;
  abstract deleteRewardBoxItem(id: string): Promise<void>;
  abstract getSettings(): Promise<any>;
  abstract saveSettings(data: any): Promise<void>;
  abstract putSettings(data: any): Promise<void>;
  abstract patchSettings(fields: any): Promise<void>;
  abstract getActiveBuffs(): Promise<any[]>;
  abstract saveActiveBuffs(items: any[]): Promise<void>;
  abstract putBuff(id: string, data: any): Promise<void>;
  abstract deleteBuff(id: string): Promise<void>;
  abstract getEfficiency(dateKey: string): Promise<any>;
  abstract saveEfficiency(dateKey: string, data: any): Promise<void>;
  abstract putEfficiency(dateKey: string, data: any): Promise<void>;
  abstract getFreeTime(dateKey: string): Promise<any[]>;
  abstract saveFreeTime(dateKey: string, tasks: any[]): Promise<void>;
  abstract putFreeTimeTask(id: string, data: any): Promise<void>;
  abstract getBountyTasks(): Promise<any[]>;
  abstract saveBountyTasks(items: any[]): Promise<void>;
  abstract getBountyTaskById(id: string): Promise<any | null>;
  abstract putBountyTask(id: string, data: any): Promise<void>;
  abstract deleteBountyTask(id: string): Promise<void>;
  abstract getBountySubmissions(dateKey: string): Promise<any[]>;
  abstract saveBountySubmissions(dateKey: string, data: any[]): Promise<void>;
  abstract putBountySubmission(id: string, data: any): Promise<void>;
  abstract getBountyCompletions(dateKey: string): Promise<any>;
  abstract saveBountyCompletions(dateKey: string, data: any): Promise<void>;
  abstract putBountyCompletion(id: string, data: any): Promise<void>;
  abstract getEmailConfig(): Promise<any | null>;
  abstract saveEmailConfig(config: any): Promise<void>;
  abstract getModifiedSince(timestamp: string): Promise<ModifiedEntry[]>;
  abstract pushMerge(changes: any[]): Promise<{ ok: boolean }>;
  abstract recordModification(tableName: string, recordKey: string, timestamp: string): Promise<void>;
  abstract resetDate(dateKey: string): Promise<void>;
  abstract saveCRDTOperation(op: CRDTOperation): Promise<void>;
  abstract applyCRDTOperation(op: CRDTOperation): Promise<void>;
  abstract getCRDTOperationsSince(timestamp: string): Promise<CRDTOperation[]>;
  abstract ackCRDTOperations(timestamp: string): Promise<void>;
}
