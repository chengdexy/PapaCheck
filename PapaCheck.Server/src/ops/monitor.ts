import { totalmem, freemem } from 'node:os';
import { statfs, readFile } from 'node:fs/promises';
import type { IDatabase, HealthSnapshot, AlertItem, OpsConfig } from '../db/types.js';

/** All possible alert keys that evaluateAlerts can generate */
export const ALL_ALERT_KEYS = ['disk_high', 'postgres_down', 'backup_stale', 'backup_failed'] as const;

/** Parse /proc/meminfo to get Swap info */
async function getSwapInfo(): Promise<{ totalBytes: number; freeBytes: number; usedPercent: number }> {
    try {
        const content = await readFile('/proc/meminfo', 'utf-8');
        const swapTotal = parseInt(content.match(/SwapTotal:\s+(\d+)/)?.[1] ?? '0', 10) * 1024;
        const swapFree = parseInt(content.match(/SwapFree:\s+(\d+)/)?.[1] ?? '0', 10) * 1024;
        const usedPercent = swapTotal > 0 ? ((swapTotal - swapFree) / swapTotal) * 100 : 0;
        return { totalBytes: swapTotal, freeBytes: swapFree, usedPercent: Math.round(usedPercent * 100) / 100 };
    } catch {
        return { totalBytes: 0, freeBytes: 0, usedPercent: 0 };
    }
}

/** Collect a health snapshot */
export async function collectHealth(db: IDatabase): Promise<HealthSnapshot> {
    const now = Date.now();

    // Disk
    let diskInfo = { totalBytes: 0, freeBytes: 0, usedPercent: 0 };
    try {
        const s = await statfs('/');
        const total = s.blocks * s.bsize;
        const free = s.bavail * s.bsize;
        diskInfo = { totalBytes: total, freeBytes: free, usedPercent: Math.round(((total - free) / total) * 100 * 100) / 100 };
    } catch { /* default to 0 */ }

    // Memory
    const totalMem = totalmem();
    const freeMem = freemem();
    const memUsedPercent = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100 * 100) / 100 : 0;

    // Swap
    const swapInfo = await getSwapInfo();

    // Postgres
    let pgAlive = true;
    let pgLatency = 0;
    try {
        const pgStart = Date.now();
        await db.getPointsBalance();
        pgLatency = Date.now() - pgStart;
    } catch {
        pgAlive = false;
        pgLatency = -1;
    }

    // Backup status
    let backupInfo = { lastSuccessAt: null as number | null, lastStatus: null as 'success' | 'failed' | null, hoursSinceLastSuccess: null as number | null };
    try {
        const latestBackup = await db.getLatestBackupRecord();
        if (latestBackup) {
            backupInfo.lastStatus = latestBackup.status;
            if (latestBackup.status === 'success') {
                backupInfo.lastSuccessAt = new Date(latestBackup.created_at).getTime();
                backupInfo.hoursSinceLastSuccess = (now - backupInfo.lastSuccessAt) / (1000 * 60 * 60);
            }
        }
    } catch { /* keep defaults */ }

    const snapshot: HealthSnapshot = {
        timestamp: now,
        disk: { usedPercent: diskInfo.usedPercent, totalBytes: diskInfo.totalBytes, freeBytes: diskInfo.freeBytes },
        memory: { usedPercent: memUsedPercent, totalBytes: totalMem, freeBytes: freeMem },
        swap: { usedPercent: swapInfo.usedPercent, totalBytes: swapInfo.totalBytes, freeBytes: swapInfo.freeBytes },
        postgres: { alive: pgAlive, latencyMs: pgLatency },
        backup: backupInfo,
        alerts: [],
    };

    // Evaluate alerts
    const config: OpsConfig | null = await db.getOpsConfig();
    const thresholds = config?.monitor?.thresholds ?? { diskCriticalPercent: 90, backupStaleHours: 25 };
    snapshot.alerts = evaluateAlerts(snapshot, thresholds);

    return snapshot;
}

/** Evaluate snapshot against thresholds and return triggered alerts */
export function evaluateAlerts(snapshot: HealthSnapshot, thresholds: { diskCriticalPercent: number; backupStaleHours: number }): AlertItem[] {
    const alerts: AlertItem[] = [];

    if (snapshot.disk.usedPercent > thresholds.diskCriticalPercent) {
        alerts.push({
            alertKey: 'disk_high',
            severity: 'critical',
            message: `磁盘使用率 ${snapshot.disk.usedPercent}% 超过阈值 ${thresholds.diskCriticalPercent}%`,
            triggeredAt: snapshot.timestamp,
        });
    }

    if (!snapshot.postgres.alive) {
        alerts.push({
            alertKey: 'postgres_down',
            severity: 'critical',
            message: 'PostgreSQL 无法连接',
            triggeredAt: snapshot.timestamp,
        });
    }

    if (snapshot.backup.hoursSinceLastSuccess !== null && snapshot.backup.hoursSinceLastSuccess > thresholds.backupStaleHours) {
        alerts.push({
            alertKey: 'backup_stale',
            severity: 'critical',
            message: `上次成功备份已超过 ${Math.round(snapshot.backup.hoursSinceLastSuccess)} 小时（阈值 ${thresholds.backupStaleHours} 小时）`,
            triggeredAt: snapshot.timestamp,
        });
    }

    if (snapshot.backup.lastStatus === 'failed') {
        alerts.push({
            alertKey: 'backup_failed',
            severity: 'warning',
            message: '最近的备份执行失败',
            triggeredAt: snapshot.timestamp,
        });
    }

    return alerts;
}
