import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IDatabase, JWTPayload, OpsConfig } from '../db/types.js';
import { runBackup, listBackups, getBackupFilePath } from '../ops/backup.js';
import { collectHealth } from '../ops/monitor.js';
import { sendAlertEmail, encryptPassword } from '../ops/alert.js';
import { OpsScheduler } from '../ops/ops-scheduler.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

// In-memory health cache (updated by monitor every 5 min)
let healthCache: { snapshot: any; events: any[]; timestamp: number } | null = null;

export function setHealthCache(snapshot: any, events: any[]): void {
    healthCache = { snapshot, events, timestamp: Date.now() };
}

export function getHealthCache(): typeof healthCache {
    return healthCache;
}

export async function opsRoutes(app: FastifyInstance, db: IDatabase, scheduler: OpsScheduler): Promise<void> {
    // Helper: check admin role
    function requireAdmin(request: FastifyRequest, reply: FastifyReply): JWTPayload | null {
        const payload = (request as any).jwtPayload as JWTPayload | undefined;
        if (!payload || payload.role !== 'admin') {
            reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
            return null;
        }
        return payload;
    }

    // GET /api/ops/health
    app.get('/api/ops/health', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;

        if (healthCache) {
            return {
                snapshot: healthCache.snapshot,
                events: healthCache.events,
                cachedAt: healthCache.timestamp,
            };
        }

        try {
            const snapshot = await collectHealth(db);
            return { snapshot, events: [], cachedAt: Date.now() };
        } catch (err: any) {
            return reply.status(500).send({ error: '采集健康状态失败', code: 'INTERNAL_ERROR' });
        }
    });

    // GET /api/ops/backups
    app.get('/api/ops/backups', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;
        return await listBackups(db, 20);
    });

    // GET /api/ops/backups/:id/download
    app.get('/api/ops/backups/:id/download', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;

        const { id } = request.params as { id: string };
        const record = await db.getBackupRecord(id);
        if (!record) {
            return reply.status(404).send({ error: '备份记录不存在', code: 'NOT_FOUND' });
        }

        const opsConfig = await db.getOpsConfig();
        const backupDir = opsConfig?.backup?.backupDir;
        const filePath = getBackupFilePath(record.filename, backupDir);
        if (!filePath) {
            return reply.status(400).send({ error: '备份文件不存在或文件名无效', code: 'VALIDATION_ERROR' });
        }

        const fileStat = await stat(filePath);
        reply.header('Content-Disposition', `attachment; filename="${record.filename}"`);
        reply.header('Content-Type', 'application/gzip');
        reply.header('Content-Length', fileStat.size);
        return reply.send(createReadStream(filePath));
    });

    // POST /api/ops/backups/trigger
    app.post('/api/ops/backups/trigger', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;

        try {
            const record = await runBackup(db, `admin:${payload.sub}`);
            reply.status(201);
            return record;
        } catch (err: any) {
            return reply.status(500).send({ error: '备份失败', code: 'INTERNAL_ERROR' });
        }
    });

    // GET /api/ops/config
    app.get('/api/ops/config', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;

        const config = await db.getOpsConfig() || {
            backup: { enabled: true, schedule: '0 3 * * *', retentionCount: 3, backupDir: '/var/backups/papacheck/' },
            monitor: { enabled: true, intervalSeconds: 300, thresholds: { diskCriticalPercent: 90, backupStaleHours: 25 } },
            alert: { suppressWindowMinutes: 30, smtp: { host: '', port: 587, secure: false, user: '', password: '***', from: '', to: '', enabled: false } },
        };

        if (config.alert?.smtp?.password) {
            config.alert.smtp.password = '***';
        }

        return config;
    });

    // PUT /api/ops/config
    app.put('/api/ops/config', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;

        const newConfig = request.body as OpsConfig;

        if (!newConfig.backup || !newConfig.monitor || !newConfig.alert) {
            return reply.status(400).send({ error: '配置不完整', code: 'VALIDATION_ERROR' });
        }

        // If SMTP password is '***', keep existing
        if (newConfig.alert?.smtp?.password === '***') {
            const existing = await db.getOpsConfig();
            if (existing?.alert?.smtp?.password) {
                newConfig.alert.smtp.password = existing.alert.smtp.password;
            }
        }

        // Encrypt SMTP password if plaintext
        const encryptionKey = process.env['ENCRYPTION_KEY'] || '';
        if (newConfig.alert?.smtp?.password && !newConfig.alert.smtp.password.includes(':') && encryptionKey) {
            newConfig.alert.smtp.password = encryptPassword(newConfig.alert.smtp.password, encryptionKey);
        }

        await db.saveOpsConfig(newConfig);
        scheduler.reload(db);

        return { ok: true };
    });

    // POST /api/ops/config/smtp/test
    app.post('/api/ops/config/smtp/test', async (request: FastifyRequest, reply: FastifyReply) => {
        const payload = requireAdmin(request, reply);
        if (!payload) return;

        const config = await db.getOpsConfig();
        if (!config?.alert?.smtp) {
            return reply.status(400).send({ error: '未配置 SMTP', code: 'VALIDATION_ERROR' });
        }

        try {
            const dummySnapshot = {
                timestamp: Date.now(),
                disk: { usedPercent: 50, totalBytes: 0, freeBytes: 0 },
                memory: { usedPercent: 50, totalBytes: 0, freeBytes: 0 },
                swap: { usedPercent: 0, totalBytes: 0, freeBytes: 0 },
                postgres: { alive: true, latencyMs: 0 },
                backup: { lastSuccessAt: Date.now(), lastStatus: 'success', hoursSinceLastSuccess: 1 },
                alerts: [{ alertKey: 'test', severity: 'warning', message: '测试邮件', triggeredAt: Date.now() }],
            };
            await sendAlertEmail(config.alert.smtp, 'test', '这是一封测试邮件', dummySnapshot as any);
            return { ok: true, message: '测试邮件已发送' };
        } catch (err: any) {
            return reply.status(500).send({ error: `发送失败: ${err.message}`, code: 'SMTP_ERROR' });
        }
    });
}
