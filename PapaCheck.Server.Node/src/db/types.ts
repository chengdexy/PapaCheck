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

export interface NotificationItem {
  id: string;
  text: string;
  createdAt: number;
}

// ==================== IDatabase 接口 ====================

export interface IDatabase {
  close(): Promise<void>;
  getFullData(): Promise<FullDataSnapshot>;
  importFullData(data: any): Promise<void>;
  addNotification(text: string, createdAt?: number): Promise<string>;
  getPendingNotifications(): Promise<NotificationItem[]>;
  consumeNotifications(ids: string[]): Promise<void>;
  getPointsBalance(): Promise<number>;
  updatePoints(action: 'earn' | 'spend', amount: number, detail: string): Promise<number>;
  patchPoints(delta: { earn?: number; spend?: number; detail?: string }): Promise<number>;
  getHomeworks(dateKey: string): Promise<any[]>;
  saveHomeworks(dateKey: string, items: any[]): Promise<void>;
  moveHomework(fromDate: string, toDate: string, hwId: string): Promise<any | null>;
  getHomeworkById(id: string): Promise<any | null>;
  putHomework(id: string, data: any): Promise<void>;
  patchHomework(id: string, fields: any): Promise<void>;
  deleteHomework(id: string): Promise<void>;
  getSettlement(dateKey: string): Promise<any>;
  saveSettlement(dateKey: string, data: any): Promise<void>;
  putSettlement(dateKey: string, data: any): Promise<void>;
  patchSettlement(dateKey: string, fields: any): Promise<void>;
  getShopItems(): Promise<any[]>;
  saveShopItems(items: any[]): Promise<void>;
  getShopItemById(id: string): Promise<any | null>;
  putShopItem(id: string, data: any): Promise<void>;
  deleteShopItem(id: string): Promise<void>;
  getRedemptions(): Promise<any[]>;
  saveRedemptions(items: any[]): Promise<void>;
  clearFulfilledRedemptions(): Promise<void>;
  putRedemption(id: string, data: any): Promise<void>;
  getRewardBox(): Promise<any[]>;
  saveRewardBox(items: any[]): Promise<void>;
  putRewardBoxItem(id: string, data: any): Promise<void>;
  deleteRewardBoxItem(id: string): Promise<void>;
  getSettings(): Promise<any>;
  saveSettings(data: any): Promise<void>;
  putSettings(data: any): Promise<void>;
  patchSettings(fields: any): Promise<void>;
  getActiveBuffs(): Promise<any[]>;
  saveActiveBuffs(items: any[]): Promise<void>;
  putBuff(id: string, data: any): Promise<void>;
  deleteBuff(id: string): Promise<void>;
  getEfficiency(dateKey: string): Promise<any>;
  saveEfficiency(dateKey: string, data: any): Promise<void>;
  putEfficiency(dateKey: string, data: any): Promise<void>;
  getFreeTime(dateKey: string): Promise<any[]>;
  saveFreeTime(dateKey: string, tasks: any[]): Promise<void>;
  putFreeTimeTask(id: string, data: any): Promise<void>;
  getBountyTasks(): Promise<any[]>;
  saveBountyTasks(items: any[]): Promise<void>;
  getBountyTaskById(id: string): Promise<any | null>;
  putBountyTask(id: string, data: any): Promise<void>;
  deleteBountyTask(id: string): Promise<void>;
  getBountySubmissions(dateKey: string): Promise<any[]>;
  saveBountySubmissions(dateKey: string, data: any[]): Promise<void>;
  putBountySubmission(id: string, data: any): Promise<void>;
  getBountyCompletions(dateKey: string): Promise<any>;
  saveBountyCompletions(dateKey: string, data: any): Promise<void>;
  putBountyCompletion(id: string, data: any): Promise<void>;
  getEmailConfig(): Promise<any | null>;
  saveEmailConfig(config: any): Promise<void>;
  getModifiedSince(timestamp: string): Promise<ModifiedEntry[]>;
  pushMerge(changes: any[]): Promise<{ ok: boolean }>;
  recordModification(tableName: string, recordKey: string, timestamp: string): Promise<void>;
  resetDate(dateKey: string): Promise<void>;
  saveCRDTOperation(op: CRDTOperation): Promise<void>;
  applyCRDTOperation(op: CRDTOperation): Promise<void>;
  getCRDTOperationsSince(timestamp: string): Promise<CRDTOperation[]>;
  ackCRDTOperations(timestamp: string): Promise<void>;
}
