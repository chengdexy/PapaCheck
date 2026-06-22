import { useState, useEffect, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useToast } from './Toast';
import Modal from './Modal';

interface HealthData {
    snapshot: {
        disk: { usedPercent: number; totalBytes: number; freeBytes: number };
        memory: { usedPercent: number; totalBytes: number; freeBytes: number };
        swap: { usedPercent: number; totalBytes: number; freeBytes: number };
        postgres: { alive: boolean; latencyMs: number };
        backup: { lastSuccessAt: number | null; lastStatus: string | null; hoursSinceLastSuccess: number | null };
    };
    events: Array<{ id: string; alert_key: string; severity: string; message: string; created_at: string }>;
}

export default function SystemHealth() {
    const { fetch: apiFetch } = useApi();
    const { showToast } = useToast();
    const [health, setHealth] = useState<HealthData | null>(null);
    const [backups, setBackups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);

    const loadHealth = useCallback(async () => {
        try {
            const data = await apiFetch<HealthData>('/api/ops/health');
            setHealth(data);
        } catch {
            // Silent fail on poll
        }
    }, [apiFetch]);

    const loadBackups = useCallback(async () => {
        try {
            const data = await apiFetch<any[]>('/api/ops/backups');
            setBackups(data);
        } catch { /* ignore */ }
    }, [apiFetch]);

    useEffect(() => {
        setLoading(true);
        Promise.all([loadHealth(), loadBackups()]).finally(() => setLoading(false));
        const interval = setInterval(loadHealth, 30_000);
        return () => clearInterval(interval);
    }, [loadHealth, loadBackups]);

    async function handleTriggerBackup() {
        try {
            await apiFetch('/api/ops/backups/trigger', { method: 'POST' });
            showToast('success', '备份已触发');
            loadBackups();
        } catch {
            showToast('error', '触发备份失败');
        }
    }

    async function handleDownload(backupId: string, filename: string) {
        try {
            const token = localStorage.getItem('papacheck_admin_token');
            const res = await fetch(`/api/ops/backups/${backupId}/download`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: '下载失败' }));
                showToast('error', err.error || '下载失败');
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            showToast('error', '下载失败');
        }
    }

    function formatBytes(bytes: number): string {
        if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
        if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
        return `${bytes} B`;
    }

    function formatTime(ts: number | null): string {
        if (!ts) return '暂无';
        const d = new Date(ts);
        return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    if (loading) {
        return (
            <div className="text-center py-6 text-[var(--color-ink-400)] text-sm">加载中...</div>
        );
    }

    return (
        <section className="mt-10">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--color-ink-700)] flex items-center gap-1.5">
                    <span className="inline-block w-1 h-4 rounded-sm bg-gradient-to-b from-violet-500 to-fuchsia-500" />
                    系统健康
                </h3>
                <button
                    onClick={() => setShowConfig(true)}
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)] transition-colors px-2 py-1 rounded-md hover:bg-[var(--color-ink-100)]"
                >
                    <Settings size={12} />
                    配置
                </button>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                <StatusCard label="磁盘" percent={health?.snapshot.disk.usedPercent ?? 0} />
                <StatusCard label="内存" percent={health?.snapshot.memory.usedPercent ?? 0} />
                <StatusCard label="Swap" percent={health?.snapshot.swap.usedPercent ?? 0} />
                <div className="bg-white rounded-lg p-3 border border-[var(--color-ink-200)]">
                    <div className="text-xs text-[var(--color-ink-500)] mb-1">PostgreSQL</div>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${health?.snapshot.postgres.alive ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className="text-sm font-semibold text-[var(--color-ink-800)]">
                            {health?.snapshot.postgres.alive ? `正常 (${health.snapshot.postgres.latencyMs}ms)` : '连接异常'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Backup Status */}
            <div className="bg-white rounded-lg p-3.5 mb-5 border border-[var(--color-ink-200)]">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--color-ink-500)]">最近备份</span>
                    <button
                        onClick={handleTriggerBackup}
                        className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] font-semibold"
                    >
                        立即备份
                    </button>
                </div>
                {health?.snapshot.backup.lastStatus === 'success' ? (
                    <div className="text-sm text-[var(--color-ink-700)]">
                        成功 · {formatTime(health.snapshot.backup.lastSuccessAt)} · {health.snapshot.backup.hoursSinceLastSuccess?.toFixed(1)} 小时前
                    </div>
                ) : health?.snapshot.backup.lastStatus === 'failed' ? (
                    <div className="text-sm text-red-600">最近备份失败</div>
                ) : (
                    <div className="text-sm text-[var(--color-ink-400)]">暂无备份</div>
                )}
            </div>

            {/* Backup List */}
            {backups.length > 0 && (
                <div className="mb-5">
                    <h4 className="text-xs font-medium text-[var(--color-ink-500)] mb-2">备份记录</h4>
                    <div className="space-y-1.5">
                        {backups.slice(0, 5).map((b: any) => (
                            <div
                                key={b.id}
                                className="flex items-center justify-between text-xs text-[var(--color-ink-700)] bg-white rounded-md px-3 py-2 border border-[var(--color-ink-200)]"
                            >
                                <span className="font-mono">{new Date(b.created_at).toLocaleString('zh-CN')}</span>
                                <span className={b.status === 'success' ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                                    {b.status === 'success' ? '成功' : '失败'}
                                </span>
                                {b.size_bytes && <span className="text-[var(--color-ink-500)]">{formatBytes(b.size_bytes)}</span>}
                                {b.status === 'success' && (
                                    <button
                                        onClick={() => handleDownload(b.id, b.filename)}
                                        className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] font-semibold"
                                    >
                                        下载
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Alert History */}
            {health && health.events.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-[var(--color-ink-500)] mb-2">告警历史</h4>
                    <div className="space-y-1.5">
                        {health.events.slice(0, 5).map((e: any) => (
                            <div
                                key={e.id}
                                className="flex items-center gap-2 text-xs text-[var(--color-ink-700)] bg-white rounded-md px-3 py-2 border border-[var(--color-ink-200)]"
                            >
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.severity === 'critical' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                                <span className="font-mono">{e.alert_key}</span>
                                <span className="text-[var(--color-ink-500)] truncate">{e.message}</span>
                                <span className="text-[var(--color-ink-400)] ml-auto flex-shrink-0">
                                    {new Date(e.created_at).toLocaleString('zh-CN')}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Config Modal */}
            {showConfig && <ConfigModal onClose={() => setShowConfig(false)} />}
        </section>
    );
}

function StatusCard({ label, percent }: { label: string; percent: number }) {
    const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-emerald-500';
    return (
        <div className="bg-white rounded-lg p-3 border border-[var(--color-ink-200)]">
            <div className="text-xs text-[var(--color-ink-500)] mb-1">{label}</div>
            <div className="text-lg font-bold text-[var(--color-ink-800)] mb-1.5">{percent}%</div>
            <div className="w-full h-1.5 bg-[var(--color-ink-100)] rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
            </div>
        </div>
    );
}

function ConfigModal({ onClose }: { onClose: () => void }) {
    const { fetch: apiFetch } = useApi();
    const { showToast } = useToast();
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch('/api/ops/config')
            .then(setConfig)
            .catch(() => showToast('error', '加载配置失败'))
            .finally(() => setLoading(false));
    }, [apiFetch, showToast]);

    async function handleSave() {
        try {
            await apiFetch('/api/ops/config', {
                method: 'PUT',
                body: JSON.stringify(config),
            });
            showToast('success', '配置已保存');
            onClose();
        } catch {
            showToast('error', '保存失败');
        }
    }

    async function handleTestEmail() {
        try {
            await apiFetch('/api/ops/config/smtp/test', { method: 'POST' });
            showToast('success', '测试邮件已发送');
        } catch {
            showToast('error', '发送测试邮件失败');
        }
    }

    if (loading) return null;

    function set(path: string, value: any) {
        setConfig((prev: any) => {
            const parts = path.split('.');
            const newConfig = JSON.parse(JSON.stringify(prev));
            let obj = newConfig;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!obj[parts[i]]) obj[parts[i]] = {};
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
            return newConfig;
        });
    }

    return (
        <Modal open title="运维配置" onClose={onClose}>
            <div className="space-y-3.5">
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">磁盘告警阈值 (%)</label>
                    <input
                        type="number"
                        className="pc-input"
                        value={config?.monitor?.thresholds?.diskCriticalPercent ?? 90}
                        onChange={e => set('monitor.thresholds.diskCriticalPercent', Number(e.target.value))}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">备份过期告警 (小时)</label>
                    <input
                        type="number"
                        className="pc-input"
                        value={config?.monitor?.thresholds?.backupStaleHours ?? 25}
                        onChange={e => set('monitor.thresholds.backupStaleHours', Number(e.target.value))}
                    />
                </div>
                <hr className="border-[var(--color-ink-200)]" />
                <p className="text-xs font-bold text-[var(--color-ink-700)]">SMTP 配置</p>
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">主机</label>
                    <input
                        className="pc-input"
                        value={config?.alert?.smtp?.host ?? ''}
                        onChange={e => set('alert.smtp.host', e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">端口</label>
                    <input
                        type="number"
                        className="pc-input"
                        value={config?.alert?.smtp?.port ?? 587}
                        onChange={e => set('alert.smtp.port', Number(e.target.value))}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">发件邮箱</label>
                    <input
                        className="pc-input"
                        value={config?.alert?.smtp?.user ?? ''}
                        onChange={e => set('alert.smtp.user', e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">授权码</label>
                    <input
                        type="text"
                        className="pc-input"
                        autoComplete="off"
                        placeholder={config?.alert?.smtp?.password === '***' ? '已加密，留空不变' : ''}
                        onChange={e => set('alert.smtp.password', e.target.value || '***')}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">收件邮箱</label>
                    <input
                        className="pc-input"
                        value={config?.alert?.smtp?.to ?? ''}
                        onChange={e => set('alert.smtp.to', e.target.value)}
                    />
                </div>
                <div className="flex gap-2 pt-2">
                    <button onClick={handleTestEmail} className="px-3 py-2 text-xs font-medium bg-[var(--color-ink-100)] text-[var(--color-ink-700)] rounded-md hover:bg-[var(--color-ink-200)] transition-colors">
                        发送测试邮件
                    </button>
                    <button onClick={handleSave} className="pc-btn-primary px-3 py-2 text-xs">
                        保存配置
                    </button>
                </div>
            </div>
        </Modal>
    );
}
