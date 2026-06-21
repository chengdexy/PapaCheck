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

// ==================== Auth Types ====================

export interface Tenant {
  id: string;
  name: string;
  display_name?: string;
  admin_id?: string;
  created_at?: string;
  is_active?: boolean;
}

export interface User {
  id: string;
  tenant_id: string;
  role: 'admin' | 'user' | 'parent' | 'child';
  nickname: string;
  access_hash?: string;
  token_version: number;
  is_active?: boolean;
  created_at?: string;
  last_login?: string;
  family_name?: string;
  first_login?: boolean;
}

export interface JWTPayload {
  sub: string;
  tenant_id: string;
  member_id?: string;
  child_id?: string;
  role: 'admin' | 'user' | 'parent' | 'child';
  nickname?: string;
  token_version: number;
  iat?: number;
  exp?: number;
}

export interface UserRecord {
  id: string;
  tenant_id: string;
  role: 'admin' | 'user' | 'parent' | 'child';
  nickname: string;
  access_hash: string;
  token_version: number;
  is_active: boolean;
  is_super_admin: boolean;
  needs_password_change: boolean;
  email?: string;
  password_hash?: string;
  family_name?: string;
  first_login?: boolean;
  created_at: string;
  last_login?: string;
}

export interface TenantListItem {
  id: string;
  name: string;
  member_count: number;
  is_active: boolean;
  created_at: string;
}

export interface AdminUser {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  token_version: number;
}

export interface CreateUserInput {
  id: string;
  role: 'admin' | 'user' | 'parent' | 'child';
  email?: string;
  password_hash?: string;
  family_name?: string;
  tenant_id?: string;
  token_version: number;
}

export interface AccessCodeRecord {
  id: string;
  tenant_id: string;
  code_hash: string;
  access_code?: string;
  child_id: string;
  token_version: number;
  last_login?: string;
  created_at: string;
}

export interface ChildrenRecord {
  id: string;
  tenant_id: string;
  name: string;
  avatar?: string;
  access_code_id?: string;
  is_active: boolean;
  created_at: string;
}

export interface CreateAccessCodeInput {
  id: string;
  tenant_id: string;
  code_hash: string;
  access_code?: string;
  child_id: string;
}

// ==================== Ops Types ====================

export interface BackupRecord {
  id: string;
  filename: string;
  size_bytes: number | null;
  status: 'success' | 'failed';
  error_message: string | null;
  checksum: string | null;
  created_at: string;
  triggered_by: string;
}

export interface HealthSnapshot {
  timestamp: number;
  disk: { usedPercent: number; totalBytes: number; freeBytes: number };
  memory: { usedPercent: number; totalBytes: number; freeBytes: number };
  swap: { usedPercent: number; totalBytes: number; freeBytes: number };
  postgres: { alive: boolean; latencyMs: number };
  backup: {
    lastSuccessAt: number | null;
    lastStatus: 'success' | 'failed' | null;
    hoursSinceLastSuccess: number | null;
  };
  alerts: AlertItem[];
}

export interface AlertItem {
  alertKey: string;
  severity: 'critical' | 'warning';
  message: string;
  triggeredAt: number;
}

export interface AlertState {
  alert_key: string;
  status: 'normal' | 'alerting';
  last_notified_at: string | null;
  first_triggered_at: string | null;
  severity: 'critical' | 'warning';
  message: string;
}

export interface HealthRecord {
  id: string;
  created_at: string;
  event_type: 'alert_triggered' | 'alert_recovered';
  alert_key: string;
  severity: 'critical' | 'warning';
  snapshot_json: string;
  message: string;
}

export interface OpsConfig {
  backup: {
    enabled: boolean;
    schedule: string;
    retentionCount: number;
    backupDir: string;
  };
  monitor: {
    enabled: boolean;
    intervalSeconds: number;
    thresholds: {
      diskCriticalPercent: number;
      backupStaleHours: number;
    };
  };
  alert: {
    suppressWindowMinutes: number;
    smtp: SmtpConfig | null;
  };
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
  enabled: boolean;
}

// ==================== IDatabase 接口 ====================

export interface IDatabase {
  close(): Promise<void>;
  getFullData(tenantId?: string, childId?: string): Promise<FullDataSnapshot>;
  importFullData(data: any, tenantId?: string, childId?: string): Promise<void>;
  addNotification(text: string, createdAt?: number, tenantId?: string): Promise<string>;
  getPendingNotifications(tenantId?: string): Promise<NotificationItem[]>;
  consumeNotifications(ids: string[], tenantId?: string): Promise<void>;
  getPointsBalance(tenantId?: string, childId?: string): Promise<number>;
  updatePoints(action: 'earn' | 'spend', amount: number, detail: string, tenantId?: string, childId?: string): Promise<number>;
  patchPoints(delta: { earn?: number; spend?: number; detail?: string }, tenantId?: string, childId?: string): Promise<number>;
  getHomeworks(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  saveHomeworks(dateKey: string, items: any[], tenantId?: string, childId?: string): Promise<void>;
  moveHomework(fromDate: string, toDate: string, hwId: string, tenantId?: string, childId?: string): Promise<any | null>;
  getHomeworkById(id: string, tenantId?: string, childId?: string): Promise<any | null>;
  putHomework(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  patchHomework(id: string, fields: any, tenantId?: string, childId?: string): Promise<void>;
  deleteHomework(id: string, tenantId?: string, childId?: string): Promise<void>;
  getSettlement(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  saveSettlement(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  putSettlement(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  patchSettlement(dateKey: string, fields: any, tenantId?: string, childId?: string): Promise<void>;
  getShopItems(tenantId?: string): Promise<any[]>;
  saveShopItems(items: any[], tenantId?: string): Promise<void>;
  getShopItemById(id: string, tenantId?: string): Promise<any | null>;
  putShopItem(id: string, data: any, tenantId?: string): Promise<void>;
  deleteShopItem(id: string, tenantId?: string): Promise<void>;
  getRedemptions(tenantId?: string, childId?: string): Promise<any[]>;
  saveRedemptions(items: any[], tenantId?: string, childId?: string): Promise<void>;
  clearFulfilledRedemptions(tenantId?: string, childId?: string): Promise<void>;
  putRedemption(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  getRewardBox(tenantId?: string, childId?: string): Promise<any[]>;
  saveRewardBox(items: any[], tenantId?: string, childId?: string): Promise<void>;
  putRewardBoxItem(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  deleteRewardBoxItem(id: string, tenantId?: string, childId?: string): Promise<void>;
  getSettings(tenantId?: string): Promise<any>;
  saveSettings(data: any, tenantId?: string): Promise<void>;
  putSettings(data: any, tenantId?: string): Promise<void>;
  patchSettings(fields: any, tenantId?: string): Promise<void>;
  getActiveBuffs(tenantId?: string, childId?: string): Promise<any[]>;
  saveActiveBuffs(items: any[], tenantId?: string, childId?: string): Promise<void>;
  putBuff(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  deleteBuff(id: string, tenantId?: string, childId?: string): Promise<void>;
  getEfficiency(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  saveEfficiency(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  putEfficiency(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  getFreeTime(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  saveFreeTime(dateKey: string, tasks: any[], tenantId?: string, childId?: string): Promise<void>;
  putFreeTimeTask(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  getBountyTasks(tenantId?: string): Promise<any[]>;
  saveBountyTasks(items: any[], tenantId?: string): Promise<void>;
  getBountyTaskById(id: string, tenantId?: string): Promise<any | null>;
  putBountyTask(id: string, data: any, tenantId?: string): Promise<void>;
  deleteBountyTask(id: string, tenantId?: string): Promise<void>;
  getBountySubmissions(dateKey: string, tenantId?: string, childId?: string): Promise<any[]>;
  saveBountySubmissions(dateKey: string, data: any[], tenantId?: string, childId?: string): Promise<void>;
  putBountySubmission(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  getBountyCompletions(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  saveBountyCompletions(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  putBountyCompletion(id: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  getEmailConfig(tenantId?: string): Promise<any | null>;
  saveEmailConfig(config: any, tenantId?: string): Promise<void>;
  getModifiedSince(timestamp: string, tenantId?: string, childId?: string): Promise<ModifiedEntry[]>;
  pushMerge(changes: any[], tenantId?: string, childId?: string): Promise<{ ok: boolean }>;
  recordModification(tableName: string, recordKey: string, timestamp: string, tenantId?: string): Promise<void>;
  resetDate(dateKey: string, tenantId?: string, childId?: string): Promise<void>;
  saveCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  hasCRDTOperation(id: string, tenantId?: string): Promise<boolean>;
  applyCRDTOperation(op: CRDTOperation, tenantId?: string): Promise<void>;
  getCRDTOperationsSince(timestamp: string, tenantId?: string): Promise<CRDTOperation[]>;
  ackCRDTOperations(timestamp: string, tenantId?: string): Promise<void>;
  queryUserTokenVersion(userId: string): Promise<number>;
  findUserByAccessHash(accessHash: string): Promise<UserRecord | null>;
  findUserByAccessCode(accessCode: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  updateUserLastLogin(userId: string): Promise<void>;
  updateAccessCodeLastLogin(id: string): Promise<void>;
  createUser(input: CreateUserInput): Promise<void>;
  findAdminByEmail(email: string): Promise<AdminUser | null>;
  findUserByEmail(email: string): Promise<any | null>;
  updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<void>;
  getAllTenants(): Promise<TenantListItem[]>;
  setTenantActive(tenantId: string, isActive: boolean): Promise<void>;
  createTenant(id: string, name: string): Promise<void>;
  createAccessCode(input: CreateAccessCodeInput): Promise<string>;
  getAccessCodesByUser(tenantId: string): Promise<AccessCodeRecord[]>;
  findAccessCodeByCode(code: string): Promise<AccessCodeRecord | null>;
  getAccessCodeById(id: string): Promise<AccessCodeRecord | null>;
  regenerateAccessCode(id: string, tenantId: string): Promise<string>;
  deleteAccessCode(id: string, tenantId: string): Promise<void>;

  // ==================== Children Methods ====================
  createChild(tenantId: string, name: string, accessCodeId?: string): Promise<ChildrenRecord>;
  getChildById(id: string, tenantId: string): Promise<ChildrenRecord | null>;
  getChildrenByTenant(tenantId: string, activeOnly?: boolean): Promise<ChildrenRecord[]>;
  updateChild(id: string, tenantId: string, fields: { name?: string; is_active?: boolean; access_code_id?: string | null }): Promise<void>;
  findChildByAccessCodeId(accessCodeId: string, tenantId: string): Promise<ChildrenRecord | null>;
  assignLegacyDataToChild(tenantId: string, childId: string): Promise<void>;

  // ==================== Ops Methods ====================
  insertBackupRecord(record: BackupRecord): Promise<void>;
  listBackupRecords(limit: number): Promise<BackupRecord[]>;
  getBackupRecord(id: string): Promise<BackupRecord | null>;
  deleteBackupRecord(id: string): Promise<void>;
  deleteBackupRecordsOlderThan(count: number): Promise<BackupRecord[]>;
  getLatestBackupRecord(): Promise<BackupRecord | null>;
  insertHealthRecord(record: HealthRecord): Promise<void>;
  listHealthRecords(limit: number): Promise<HealthRecord[]>;
  pruneHealthRecords(maxRows: number): Promise<void>;
  getAlertState(key: string): Promise<AlertState | null>;
  upsertAlertState(state: AlertState): Promise<void>;
  getOpsConfig(): Promise<OpsConfig | null>;
  saveOpsConfig(config: OpsConfig): Promise<void>;
}
