import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateTransport, mockSendMail } = vi.hoisted(() => {
    const sendMail = vi.fn(async () => ({}));
    const verify = vi.fn(async () => true);
    return {
        mockCreateTransport: vi.fn(() => ({ sendMail, verify })),
        mockSendMail: sendMail,
    };
});

vi.mock('nodemailer', () => ({
    default: { createTransport: mockCreateTransport },
    createTransport: mockCreateTransport,
}));

import { processAlerts, encryptPassword, decryptPassword } from '../../src/ops/alert.js';
import type { IDatabase, HealthSnapshot, AlertState, SmtpConfig } from '../../src/db/types.js';

function createMockDb(): IDatabase & { storedAlertState: Record<string, AlertState>; storedHealthRecords: any[] } {
    const storedAlertState: Record<string, AlertState> = {};
    const storedHealthRecords: any[] = [];
    return {
        storedAlertState, storedHealthRecords,
        getAlertState: async (key: string) => storedAlertState[key] ?? null,
        upsertAlertState: async (state: AlertState) => { storedAlertState[state.alert_key] = state; },
        insertHealthRecord: async (r: any) => { storedHealthRecords.push(r); },
        getOpsConfig: async () => null,
        pruneHealthRecords: async () => { },
        close: async () => { },
        getFullData: async () => ({} as any), importFullData: async () => { },
        addNotification: async () => '', getPendingNotifications: async () => [], consumeNotifications: async () => { },
        getPointsBalance: async () => 0, updatePoints: async () => 0, patchPoints: async () => 0,
        getHomeworks: async () => [], saveHomeworks: async () => { }, moveHomework: async () => null,
        getHomeworkById: async () => null, putHomework: async () => { }, patchHomework: async () => { }, deleteHomework: async () => { },
        getSettlement: async () => null, saveSettlement: async () => { }, putSettlement: async () => { }, patchSettlement: async () => { },
        getShopItems: async () => [], saveShopItems: async () => { }, getShopItemById: async () => null,
        putShopItem: async () => { }, deleteShopItem: async () => { },
        getRedemptions: async () => [], saveRedemptions: async () => { }, clearFulfilledRedemptions: async () => { }, putRedemption: async () => { },
        getRewardBox: async () => [], saveRewardBox: async () => { }, putRewardBoxItem: async () => { }, deleteRewardBoxItem: async () => { },
        getSettings: async () => ({}), saveSettings: async () => { }, putSettings: async () => { }, patchSettings: async () => { },
        getActiveBuffs: async () => [], saveActiveBuffs: async () => { }, putBuff: async () => { }, deleteBuff: async () => { },
        getEfficiency: async () => null, saveEfficiency: async () => { }, putEfficiency: async () => { },
        getFreeTime: async () => [], saveFreeTime: async () => { }, putFreeTimeTask: async () => { },
        getBountyTasks: async () => [], saveBountyTasks: async () => { }, getBountyTaskById: async () => null,
        putBountyTask: async () => { }, deleteBountyTask: async () => { },
        getBountySubmissions: async () => [], saveBountySubmissions: async () => { }, putBountySubmission: async () => { },
        getBountyCompletions: async () => ({}), saveBountyCompletions: async () => { }, putBountyCompletion: async () => { },
        getEmailConfig: async () => null, saveEmailConfig: async () => { },
        getModifiedSince: async () => [], pushMerge: async () => ({ ok: true }), recordModification: async () => { }, resetDate: async () => { },
        saveCRDTOperation: async () => { }, applyCRDTOperation: async () => { }, getCRDTOperationsSince: async () => [], ackCRDTOperations: async () => { },
        queryUserTokenVersion: async () => 1, findUserByAccessHash: async () => null, findUserByAccessCode: async () => null,
        getUserById: async () => null, updateUserLastLogin: async () => { }, updateAccessCodeLastLogin: async () => { },
        createUser: async () => { }, findAdminByEmail: async () => null, findUserByEmail: async () => null,
        updateUserCredentials: async () => { }, getAllTenants: async () => [], setTenantActive: async () => { },
        createAccessCode: async () => '', getAccessCodesByUser: async () => [], findAccessCodeByCode: async () => null,
        getAccessCodeById: async () => null, regenerateAccessCode: async () => '', deleteAccessCode: async () => { },
        listBackupRecords: async () => [], getBackupRecord: async () => null, deleteBackupRecord: async () => { },
        deleteBackupRecordsOlderThan: async () => [], getLatestBackupRecord: async () => null, insertBackupRecord: async () => { },
        listHealthRecords: async () => [], saveOpsConfig: async () => { },
    } as any;
}

const smtpConfig: SmtpConfig = {
    host: 'smtp.test.com', port: 587, secure: false,
    user: 'test@test.com', password: 'pass', from: 'test@test.com', to: 'admin@test.com', enabled: true,
};

const makeSnapshot = (overrides: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
    timestamp: Date.now(),
    disk: { usedPercent: 95, totalBytes: 1e10, freeBytes: 5e8 },
    memory: { usedPercent: 80, totalBytes: 2e9, freeBytes: 4e8 },
    swap: { usedPercent: 50, totalBytes: 2e9, freeBytes: 1e9 },
    postgres: { alive: true, latencyMs: 5 },
    backup: { lastSuccessAt: Date.now() - 1e6, lastStatus: 'success', hoursSinceLastSuccess: 0.3 },
    alerts: [],
    ...overrides,
});

describe('alert module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normal → alerting → 发邮件 + 写 health_record', async () => {
        const db = createMockDb() as any;
        const snapshot = makeSnapshot({
            disk: { usedPercent: 96, totalBytes: 1e10, freeBytes: 4e8 },
            alerts: [{ alertKey: 'disk_high', severity: 'critical', message: '磁盘使用率 96%', triggeredAt: Date.now() }],
        });

        await processAlerts(db, snapshot, { diskCriticalPercent: 90, backupStaleHours: 25 }, smtpConfig);

        expect(mockSendMail).toHaveBeenCalled();
        expect(db.storedHealthRecords.length).toBe(1);
        expect(db.storedHealthRecords[0].event_type).toBe('alert_triggered');
        expect(db.storedAlertState['disk_high']).toBeTruthy();
        expect(db.storedAlertState['disk_high'].status).toBe('alerting');
    });

    it('alerting + 抑制窗口内 → 不发邮件', async () => {
        const db = createMockDb() as any;
        db.storedAlertState['disk_high'] = {
            alert_key: 'disk_high', status: 'alerting',
            last_notified_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            first_triggered_at: new Date().toISOString(),
            severity: 'critical', message: '之前的告警',
        };

        const snapshot = makeSnapshot({
            disk: { usedPercent: 96, totalBytes: 1e10, freeBytes: 4e8 },
            alerts: [{ alertKey: 'disk_high', severity: 'critical', message: '磁盘使用率 96%', triggeredAt: Date.now() }],
        });

        await processAlerts(db, snapshot, { diskCriticalPercent: 90, backupStaleHours: 25 }, smtpConfig);

        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('alerting → normal → 写恢复事件，不发邮件', async () => {
        const db = createMockDb() as any;
        db.storedAlertState['disk_high'] = {
            alert_key: 'disk_high', status: 'alerting',
            last_notified_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            first_triggered_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            severity: 'critical', message: '之前的告警',
        };

        const snapshot = makeSnapshot({
            disk: { usedPercent: 50, totalBytes: 1e10, freeBytes: 5e9 },
            alerts: [],
        });

        await processAlerts(db, snapshot, { diskCriticalPercent: 90, backupStaleHours: 25 }, smtpConfig);

        expect(db.storedHealthRecords.length).toBe(1);
        expect(db.storedHealthRecords[0].event_type).toBe('alert_recovered');
        expect(mockSendMail).not.toHaveBeenCalled();
        expect(db.storedAlertState['disk_high'].status).toBe('normal');
    });

    it('加密/解密 SMTP 密码', () => {
        const key = 'a'.repeat(64); // 32-byte key in hex = 64 hex chars
        const password = 'my-smtp-password!123';
        const encrypted = encryptPassword(password, key);
        expect(encrypted).not.toBe(password);
        expect(encrypted).toContain(':');
        const decrypted = decryptPassword(encrypted, key);
        expect(decrypted).toBe(password);
    });
});
