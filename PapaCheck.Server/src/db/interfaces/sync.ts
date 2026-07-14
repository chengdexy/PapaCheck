import type { CRDTOperation } from '../../crdt/types.js';
import type { ModifiedEntry, NotificationItem, FullDataSnapshot } from '../types.js';
import type { SettingsDTO, EmailConfigDTO } from '../dto.js';

export interface ISyncStore {
  close(): Promise<void>;
  getFullData(tenantId?: string, childId?: string): Promise<FullDataSnapshot>;
  importFullData(data: FullDataSnapshot, tenantId?: string, childId?: string): Promise<void>;
  addNotification(text: string, createdAt?: number, tenantId?: string): Promise<string>;
  getPendingNotifications(tenantId?: string): Promise<NotificationItem[]>;
  consumeNotifications(ids: string[], tenantId?: string): Promise<void>;
  getModifiedSince(timestamp: string, tenantId?: string, childId?: string): Promise<ModifiedEntry[]>;
  /**
   * 轻量数据版本戳：返回租户维度 last_modified 的 MAX 时间戳与行数组合。
   * 用于前端条件短轮询，只有版本变化时才触发全量拉取。
   * 无任何记录时返回 null。
   */
  getDataVersion(tenantId?: string): Promise<string | null>;
  pushMerge(changes: ModifiedEntry[], tenantId?: string, childId?: string): Promise<{ ok: boolean }>;
  recordModification(tableName: string, recordKey: string, timestamp: string, tenantId?: string): Promise<void>;
  saveCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  hasCRDTOperation(id: string, tenantId?: string): Promise<boolean>;
  applyCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  getCRDTOperationsSince(timestamp: string, tenantId?: string): Promise<CRDTOperation[]>;
  ackCRDTOperations(timestamp: string, tenantId?: string): Promise<void>;
  getEmailConfig(tenantId?: string): Promise<EmailConfigDTO | null>;
  saveEmailConfig(config: EmailConfigDTO, tenantId?: string): Promise<void>;
  getSettings(tenantId?: string): Promise<SettingsDTO>;
  saveSettings(data: SettingsDTO, tenantId?: string): Promise<void>;
  putSettings(data: SettingsDTO, tenantId?: string): Promise<void>;
  patchSettings(fields: Partial<SettingsDTO>, tenantId?: string): Promise<void>;
}
