import type { BackupRecord, HealthRecord, AlertState, OpsConfig } from '../types.js';
export interface IOpsStore {
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
