import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mocks that work with hoisted vi.mock
const { mockTotalmem, mockFreemem } = vi.hoisted(() => ({
    mockTotalmem: vi.fn(() => 2 * 1024 * 1024 * 1024),
    mockFreemem: vi.fn(() => 1 * 1024 * 1024 * 1024),
}));
const { mockStatfs } = vi.hoisted(() => ({
    mockStatfs: vi.fn(),
}));

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();
    return {
        ...actual,
        totalmem: () => mockTotalmem(),
        freemem: () => mockFreemem(),
        hostname: () => 'test-server',
    };
});
vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return {
        ...actual,
        statfs: mockStatfs,
        readFile: vi.fn(),
    };
});

import { collectHealth, evaluateAlerts } from '../../src/ops/monitor.js';
import type { IDatabase } from '../../src/db/types.js';

describe('monitor module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStatfs.mockResolvedValue({
            type: 0x01021994,
            bsize: 4096,
            blocks: 10_000_000,
            bfree: 1_000_000,
            bavail: 900_000,
        });
    });

    it('collectHealth 返回正确结构', async () => {
        const db = {
            getLatestBackupRecord: async () => null,
            getOpsConfig: async () => null,
            ping: async () => {},
        } as any as IDatabase;
        const snapshot = await collectHealth(db);
        expect(snapshot).toHaveProperty('timestamp');
        expect(snapshot).toHaveProperty('disk');
        expect(snapshot).toHaveProperty('memory');
        expect(snapshot).toHaveProperty('swap');
        expect(snapshot).toHaveProperty('postgres');
        expect(snapshot).toHaveProperty('backup');
        expect(snapshot).toHaveProperty('alerts');
        expect(typeof snapshot.disk.usedPercent).toBe('number');
        expect(typeof snapshot.memory.usedPercent).toBe('number');
    });

    it('PG 连接失败标记 alive=false', async () => {
        const db = {
            getLatestBackupRecord: async () => null,
            getOpsConfig: async () => null,
            ping: async () => { throw new Error('connection refused'); },
        } as any as IDatabase;
        const snapshot = await collectHealth(db);
        expect(snapshot.postgres.alive).toBe(false);
        expect(snapshot.postgres.latencyMs).toBe(-1);
        expect(snapshot.alerts.some(a => a.alertKey === 'postgres_down')).toBe(true);
    });

    it('备份超 25h 触发 backup_stale 告警', async () => {
        const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
        const db = {
            getLatestBackupRecord: async () => ({
                id: '1', filename: 'test.sql.gz', status: 'success',
                created_at: oldDate, triggered_by: 'scheduler',
                size_bytes: 100, error_message: null, checksum: null,
            }),
            getOpsConfig: async () => null,
            ping: async () => {},
        } as any as IDatabase;
        const snapshot = await collectHealth(db);
        const backupAlert = snapshot.alerts.find(a => a.alertKey === 'backup_stale');
        expect(backupAlert).toBeTruthy();
        expect(backupAlert!.severity).toBe('critical');
    });
});
