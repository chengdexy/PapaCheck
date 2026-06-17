import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { IDatabase, HealthSnapshot, AlertItem, AlertState, SmtpConfig, OpsConfig } from '../db/types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/** Encrypt password with AES-256-GCM */
export function encryptPassword(password: string, key: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/** Decrypt password encrypted with AES-256-GCM */
export function decryptPassword(encrypted: string, key: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const [ivHex, authTagHex, data] = parts;
    const decipher = createDecipheriv(ALGORITHM, Buffer.from(key, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/** Build nodemailer transport from config */
function createTransport(smtp: SmtpConfig): nodemailer.Transporter {
    const encryptionKey = process.env['ENCRYPTION_KEY'] || '';
    let password = smtp.password;
    if (password && password.includes(':') && encryptionKey) {
        try { password = decryptPassword(password, encryptionKey); } catch { /* use as-is */ }
    }
    return nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: password },
    });
}

/** Send an alert email */
export async function sendAlertEmail(
    smtp: SmtpConfig,
    alertKey: string,
    message: string,
    snapshot: HealthSnapshot
): Promise<void> {
    if (!smtp.enabled) return;

    const transport = createTransport(smtp);
    const now = new Date().toISOString();
    const severity = snapshot.alerts.find(a => a.alertKey === alertKey)?.severity ?? 'unknown';

    await transport.sendMail({
        from: smtp.from,
        to: smtp.to,
        subject: `[PapaCheck] 告警: ${alertKey}`,
        html: `
      <h2>PapaCheck 运维告警</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">
        <tr><td>告警项</td><td>${alertKey}</td></tr>
        <tr><td>严重级别</td><td>${severity}</td></tr>
        <tr><td>描述</td><td>${message}</td></tr>
        <tr><td>时间</td><td>${now}</td></tr>
        <tr><td>服务器</td><td>test-server</td></tr>
        <tr><td>磁盘使用率</td><td>${snapshot.disk.usedPercent}%</td></tr>
        <tr><td>内存使用率</td><td>${snapshot.memory.usedPercent}%</td></tr>
        <tr><td>PG 状态</td><td>${snapshot.postgres.alive ? '正常' : '异常'}</td></tr>
      </table>
      <p><a href="https://papacheck.chengdexy.cn/admin/">查看管理面板</a></p>
    `,
    });
}

/** Process alerts: evaluate state machine and trigger emails */
export async function processAlerts(
    db: IDatabase,
    snapshot: HealthSnapshot,
    thresholds: { diskCriticalPercent: number; backupStaleHours: number },
    smtpConfig: SmtpConfig
): Promise<AlertItem[]> {
    const events: AlertItem[] = [];
    const now = new Date().toISOString();
    const nowMs = Date.now();

    for (const alert of snapshot.alerts) {
        const existingState = await db.getAlertState(alert.alertKey);

        if (!existingState || existingState.status === 'normal') {
            const state: AlertState = {
                alert_key: alert.alertKey,
                status: 'alerting',
                last_notified_at: now,
                first_triggered_at: now,
                severity: alert.severity,
                message: alert.message,
            };
            await db.upsertAlertState(state);
            await db.insertHealthRecord({
                id: randomUUID(),
                created_at: now,
                event_type: 'alert_triggered',
                alert_key: alert.alertKey,
                severity: alert.severity,
                snapshot_json: JSON.stringify(snapshot),
                message: alert.message,
            });
            if (smtpConfig.enabled) {
                try {
                    await sendAlertEmail(smtpConfig, alert.alertKey, alert.message, snapshot);
                } catch (err) {
                    console.error(`[ops] Failed to send alert email for ${alert.alertKey}:`, err);
                }
            }
            events.push(alert);
        } else {
            const lastNotified = existingState.last_notified_at ? new Date(existingState.last_notified_at).getTime() : 0;
            const opsConfig: OpsConfig | null = await db.getOpsConfig();
            const suppressWindow = (opsConfig?.alert?.suppressWindowMinutes ?? 30) * 60 * 1000;

            if (nowMs - lastNotified > suppressWindow) {
                existingState.last_notified_at = now;
                existingState.message = alert.message;
                await db.upsertAlertState(existingState);
                if (smtpConfig.enabled) {
                    try {
                        await sendAlertEmail(smtpConfig, alert.alertKey, alert.message, snapshot);
                    } catch (err) {
                        console.error(`[ops] Failed to resend alert email for ${alert.alertKey}:`, err);
                    }
                }
            }
        }
    }

    // Check for recovered alerts
    const currentAlertKeys = new Set(snapshot.alerts.map(a => a.alertKey));
    const allStateKeys = ['disk_high', 'postgres_down', 'backup_stale', 'backup_failed'];

    for (const key of allStateKeys) {
        if (currentAlertKeys.has(key)) continue;
        const existingState = await db.getAlertState(key);
        if (existingState && existingState.status === 'alerting') {
            const state: AlertState = {
                alert_key: key,
                status: 'normal',
                last_notified_at: existingState.last_notified_at,
                first_triggered_at: null,
                severity: existingState.severity,
                message: '已恢复',
            };
            await db.upsertAlertState(state);
            await db.insertHealthRecord({
                id: randomUUID(),
                created_at: now,
                event_type: 'alert_recovered',
                alert_key: key,
                severity: existingState.severity,
                snapshot_json: JSON.stringify(snapshot),
                message: `告警已恢复: ${key}`,
            });
        }
    }

    try { await db.pruneHealthRecords(1000); } catch { /* ignore */ }

    return events;
}
