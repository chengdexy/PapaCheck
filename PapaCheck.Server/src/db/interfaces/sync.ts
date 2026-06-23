import type { CRDTOperation } from '../../crdt/types.js';
import type { ModifiedEntry, NotificationItem, FullDataSnapshot } from '../types.js';
export interface ISyncStore {
  close(): Promise<void>;
  getFullData(tenantId?: string, childId?: string): Promise<FullDataSnapshot>;
  importFullData(data: any, tenantId?: string, childId?: string): Promise<void>;
  addNotification(text: string, createdAt?: number, tenantId?: string): Promise<string>;
  getPendingNotifications(tenantId?: string): Promise<NotificationItem[]>;
  consumeNotifications(ids: string[], tenantId?: string): Promise<void>;
  getModifiedSince(timestamp: string, tenantId?: string, childId?: string): Promise<ModifiedEntry[]>;
  pushMerge(changes: any[], tenantId?: string, childId?: string): Promise<{ ok: boolean }>;
  recordModification(tableName: string, recordKey: string, timestamp: string, tenantId?: string): Promise<void>;
  saveCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  hasCRDTOperation(id: string, tenantId?: string): Promise<boolean>;
  applyCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  getCRDTOperationsSince(timestamp: string, tenantId?: string): Promise<CRDTOperation[]>;
  ackCRDTOperations(timestamp: string, tenantId?: string): Promise<void>;
  getEmailConfig(tenantId?: string): Promise<any | null>;
  saveEmailConfig(config: any, tenantId?: string): Promise<void>;
  getSettings(tenantId?: string): Promise<any>;
  saveSettings(data: any, tenantId?: string): Promise<void>;
  putSettings(data: any, tenantId?: string): Promise<void>;
  patchSettings(fields: any, tenantId?: string): Promise<void>;
}
