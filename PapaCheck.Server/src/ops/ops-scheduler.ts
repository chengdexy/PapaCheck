import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { IDatabase, OpsConfig, SmtpConfig } from '../db/types.js';
import { runBackup } from './backup.js';
import { collectHealth } from './monitor.js';
import { processAlerts, sendDailyReport } from './alert.js';

export class OpsScheduler {
    private backupJob: ScheduledTask | null = null;
    private monitorTimer: ReturnType<typeof setInterval> | null = null;
    private db: IDatabase | null = null;

    /** Start all scheduled tasks */
    start(db: IDatabase): void {
        this.db = db;
        this.scheduleBackup(db);
        this.scheduleMonitor(db);
    }

    /** Stop all scheduled tasks */
    stop(): void {
        if (this.backupJob) { this.backupJob.stop(); this.backupJob = null; }
        if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null; }
    }

    /** Reload all tasks (call after config change) */
    reload(db: IDatabase): void {
        this.stop();
        this.start(db);
    }

    private async scheduleBackup(db: IDatabase): Promise<void> {
        const config: OpsConfig | null = await db.getOpsConfig();
        const schedule = config?.backup?.schedule ?? '0 3 * * *';
        const enabled = config?.backup?.enabled ?? true;

        if (!enabled) return;

        this.backupJob = cron.schedule(schedule, async () => {
            let record: { status: string; filename: string; size_bytes: number | null; error_message: string | null; created_at: string };
            try {
                record = await runBackup(db, 'scheduler');
                console.log(`[ops] 备份 ${record.status}: ${record.filename}`);
            } catch (err) {
                console.error('[ops] 定时备份失败:', err);
                record = { status: 'failed', filename: 'unknown', size_bytes: null, error_message: String(err), created_at: new Date().toISOString() };
            }
            // Send daily report with backup result + health snapshot
            try {
                const snapshot = await collectHealth(db);
                await sendDailyReport(db, record, snapshot);
                console.log('[ops] 日报邮件已发送');
            } catch (err) {
                console.error('[ops] 发送日报邮件失败:', err);
            }
        });
    }

    private async scheduleMonitor(db: IDatabase): Promise<void> {
        const config: OpsConfig | null = await db.getOpsConfig();
        const interval = (config?.monitor?.intervalSeconds ?? 300) * 1000;
        const enabled = config?.monitor?.enabled ?? true;

        if (!enabled) return;

        const run = async () => {
            try {
                const currentConfig: OpsConfig | null = await db.getOpsConfig();
                const thresholds = currentConfig?.monitor?.thresholds ?? { diskCriticalPercent: 90, backupStaleHours: 25 };
                const smtpRaw = currentConfig?.alert?.smtp ?? null;
                const smtpConfig: SmtpConfig = smtpRaw ?? {
                    host: '', port: 587, secure: false, user: '', password: '', from: '', to: '', enabled: false,
                };
                const snapshot = await collectHealth(db);
                await processAlerts(db, snapshot, thresholds, smtpConfig);
            } catch (err) {
                console.error('[ops] 监控采集失败:', err);
            }
        };

        // Run immediately, then on interval
        await run();
        this.monitorTimer = setInterval(run, interval);
    }
}
