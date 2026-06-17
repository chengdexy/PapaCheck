import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Use vi.hoisted to create mocks that work with hoisted vi.mock
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));
const { mockMkdir, mockUnlink, mockStat } = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
  mockUnlink: vi.fn(),
  mockStat: vi.fn(),
  mockReaddir: vi.fn(),
  mockCreateReadStream: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
vi.mock('node:fs', () => {
  const { Readable } = require('stream');
  return {
    default: {
      promises: { mkdir: mockMkdir, unlink: mockUnlink, stat: mockStat, readdir: vi.fn() },
      createReadStream: () => { const s = new Readable(); s.push(null); return s; },
      existsSync: () => true,
    },
    promises: { mkdir: mockMkdir, unlink: mockUnlink, stat: mockStat, readdir: vi.fn() },
    createReadStream: () => { const s = new Readable(); s.push(null); return s; },
    existsSync: () => true,
  };
});
vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  unlink: mockUnlink,
  stat: mockStat,
  readdir: vi.fn(),
}));

import { runBackup, triggerBackupManually, listBackups, getBackupFilePath, pruneOldBackups } from '../../src/ops/backup.js';
import type { IDatabase, BackupRecord } from '../../src/db/types.js';

// Helper to create a mock DB
function createMockDb(): IDatabase {
  const records: BackupRecord[] = [];
  return {
    insertBackupRecord: async (r: BackupRecord) => { records.push(r); },
    listBackupRecords: async (limit: number) => records.slice(0, limit),
    getBackupRecord: async (id: string) => records.find(r => r.id === id) ?? null,
    deleteBackupRecord: async (id: string) => { const i = records.findIndex(r => r.id === id); if (i >= 0) records.splice(i, 1); },
    deleteBackupRecordsOlderThan: async (count: number) => {
      const sorted = [...records.filter(r => r.status === 'success')].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (sorted.length <= count) return [];
      const toDelete = sorted.slice(count);
      for (const r of toDelete) records.splice(records.findIndex(x => x.id === r.id), 1);
      return toDelete;
    },
    getLatestBackupRecord: async () => records.length > 0 ? records.reduce((a, b) => a.created_at > b.created_at ? a : b) : null,
    getOpsConfig: async () => ({
      backup: { enabled: true, schedule: '0 3 * * *', retentionCount: 3, backupDir: '/tmp/backups/' },
      monitor: { enabled: true, intervalSeconds: 300, thresholds: { diskCriticalPercent: 90, backupStaleHours: 25 } },
      alert: { suppressWindowMinutes: 30, smtp: null },
    }),
    close: async () => {},
    getFullData: async () => ({} as any),
    importFullData: async () => {},
    addNotification: async () => '',
    getPendingNotifications: async () => [],
    consumeNotifications: async () => {},
    getPointsBalance: async () => 0,
    updatePoints: async () => 0,
    patchPoints: async () => 0,
    getHomeworks: async () => [],
    saveHomeworks: async () => {},
    moveHomework: async () => null,
    getHomeworkById: async () => null,
    putHomework: async () => {},
    patchHomework: async () => {},
    deleteHomework: async () => {},
    getSettlement: async () => null,
    saveSettlement: async () => {},
    putSettlement: async () => {},
    patchSettlement: async () => {},
    getShopItems: async () => [],
    saveShopItems: async () => {},
    getShopItemById: async () => null,
    putShopItem: async () => {},
    deleteShopItem: async () => {},
    getRedemptions: async () => [],
    saveRedemptions: async () => {},
    clearFulfilledRedemptions: async () => {},
    putRedemption: async () => {},
    getRewardBox: async () => [],
    saveRewardBox: async () => {},
    putRewardBoxItem: async () => {},
    deleteRewardBoxItem: async () => {},
    getSettings: async () => ({}),
    saveSettings: async () => {},
    putSettings: async () => {},
    patchSettings: async () => {},
    getActiveBuffs: async () => [],
    saveActiveBuffs: async () => {},
    putBuff: async () => {},
    deleteBuff: async () => {},
    getEfficiency: async () => null,
    saveEfficiency: async () => {},
    putEfficiency: async () => {},
    getFreeTime: async () => [],
    saveFreeTime: async () => {},
    putFreeTimeTask: async () => {},
    getBountyTasks: async () => [],
    saveBountyTasks: async () => {},
    getBountyTaskById: async () => null,
    putBountyTask: async () => {},
    deleteBountyTask: async () => {},
    getBountySubmissions: async () => [],
    saveBountySubmissions: async () => {},
    putBountySubmission: async () => {},
    getBountyCompletions: async () => ({}),
    saveBountyCompletions: async () => {},
    putBountyCompletion: async () => {},
    getEmailConfig: async () => null,
    saveEmailConfig: async () => {},
    getModifiedSince: async () => [],
    pushMerge: async () => ({ ok: true }),
    recordModification: async () => {},
    resetDate: async () => {},
    saveCRDTOperation: async () => {},
    applyCRDTOperation: async () => {},
    getCRDTOperationsSince: async () => [],
    ackCRDTOperations: async () => {},
    queryUserTokenVersion: async () => 1,
    findUserByAccessHash: async () => null,
    findUserByAccessCode: async () => null,
    getUserById: async () => null,
    updateUserLastLogin: async () => {},
    updateAccessCodeLastLogin: async () => {},
    createUser: async () => {},
    findAdminByEmail: async () => null,
    findUserByEmail: async () => null,
    updateUserCredentials: async () => {},
    getAllTenants: async () => [],
    setTenantActive: async () => {},
    createAccessCode: async () => '',
    getAccessCodesByUser: async () => [],
    findAccessCodeByCode: async () => null,
    getAccessCodeById: async () => null,
    regenerateAccessCode: async () => '',
    deleteAccessCode: async () => {},
    insertHealthRecord: async () => {},
    listHealthRecords: async () => [],
    pruneHealthRecords: async () => {},
    getAlertState: async () => null,
    upsertAlertState: async () => {},
    saveOpsConfig: async () => {},
  } as IDatabase;
}

describe('backup module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 12345 } as any);
  });

  // Scenario: 成功执行备份 → 文件存在 + 记录入库
  it('成功执行备份返回 BackupRecord', async () => {
    const db = createMockDb();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => cb(null, 'stdout', 'stderr'));

    const record = await runBackup(db, 'scheduler');

    // Debug: if failed, show error message
    if (record.status !== 'success') {
      console.error('Backup failed with error:', record.error_message);
    }

    expect(record.status).toBe('success');
    expect(record.filename).toMatch(/^papacheck-\d{8}-\d{6}\.sql\.gz$/);
    expect(record.size_bytes).toBe(12345);
    expect(record.triggered_by).toBe('scheduler');
    expect(record.checksum).toBeTruthy();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockExecFile.mock.calls[0];
    expect(cmd).toBe('pg_dump');
    expect(args).toContain('-Fc');
  }, 10000);

  // Scenario: pg_dump 失败 → 记录 status=failed
  it('pg_dump 失败记录 status=failed', async () => {
    const db = createMockDb();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => cb(new Error('connection refused'), null, 'error msg'));

    const record = await runBackup(db, 'scheduler');

    expect(record.status).toBe('failed');
    expect(record.error_message).toBeTruthy();
  });

  // Scenario: 保留份数超 3 → 删除最旧文件 + 记录
  it('保留份数超 3 清理旧备份', async () => {
    const db = createMockDb();
    for (let i = 0; i < 4; i++) {
      await db.insertBackupRecord({
        id: crypto.randomUUID(), filename: `papacheck-20260101-00000${i}.sql.gz`, size_bytes: 100,
        status: 'success', error_message: null, checksum: null,
        created_at: `2026-01-01T00:00:0${i}Z`, triggered_by: 'scheduler',
      });
    }

    const deleted = await pruneOldBackups(db, 3);

    expect(deleted).toBe(1);
    const remaining = await db.listBackupRecords(10);
    expect(remaining.length).toBe(3);
  });

  // Scenario: getBackupFilePath 路径遍历防护
  it('getBackupFilePath 拒绝路径遍历', () => {
    const result = getBackupFilePath('../../etc/passwd');
    expect(result).toBeNull();
  });

  it('getBackupFilePath 接受合法文件名', () => {
    const result = getBackupFilePath('papacheck-20260617-030000.sql.gz');
    expect(result).toContain('papacheck-20260617-030000.sql.gz');
  });

  // Scenario: triggerBackupManually 手动触发
  it('triggerBackupManually 返回备份记录', async () => {
    const db = createMockDb();
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => cb(null, 'stdout', 'stderr'));

    const record = await triggerBackupManually(db, 'admin-id-1');
    expect(record.status).toBe('success');
    expect(record.triggered_by).toBe('admin:admin-id-1');
  });
});
