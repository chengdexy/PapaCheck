import { useState, useEffect, useCallback } from 'react';
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
        return <div className="text-center py-4 text-zinc-400 text-sm">加载中...</div>;
    }

    return (
        <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-zinc-500">系统健康</h3>
                <button onClick={() => setShowConfig(true)} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">⚙️ 配置</button>
            </div>

            {/* Status Cards */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <StatusCard label="磁盘" percent={health?.snapshot.disk.usedPercent ?? 0} />
                <StatusCard label="内存" percent={health?.snapshot.memory.usedPercent ?? 0} />
                <StatusCard label="Swap" percent={health?.snapshot.swap.usedPercent ?? 0} />
                <div className="bg-zinc-50 rounded-md p-3">
                    <div className="text-xs text-zinc-400 mb-1">PostgreSQL</div>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${health?.snapshot.postgres.alive ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-sm font-medium text-zinc-700">
                            {health?.snapshot.postgres.alive ? `正常 (${health.snapshot.postgres.latencyMs}ms)` : '连接异常'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Backup Status */}
            <div className="bg-zinc-50 rounded-md p-3 mb-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-zinc-400">最近备份</span>
                    <button onClick={handleTriggerBackup} className="text-xs text-orange-600 hover:text-orange-700 font-medium">
                        立即备份
                    </button>
                </div>
                {health?.snapshot.backup.lastStatus === 'success' ? (
                    <div className="text-sm text-zinc-700">
                        成功 · {formatTime(health.snapshot.backup.lastSuccessAt)} · {health.snapshot.backup.hoursSinceLastSuccess?.toFixed(1)} 小时前
                    </div>
                ) : health?.snapshot.backup.lastStatus === 'failed' ? (
                    <div className="text-sm text-red-600">最近备份失败</div>
                ) : (
                    <div className="text-sm text-zinc-400">暂无备份</div>
                )}
            </div>

            {/* Backup List */}
            {backups.length > 0 && (
                <div className="mb-6">
                    <h4 className="text-xs text-zinc-400 mb-2">备份记录</h4>
                    <div className="space-y-1">
                        {backups.slice(0, 5).map((b: any) => (
                            <div key={b.id} className="flex items-center justify-between text-xs text-zinc-600 bg-zinc-50 rounded px-2 py-1.5">
                                <span>{new Date(b.created_at).toLocaleString('zh-CN')}</span>
                                <span className={b.status === 'success' ? 'text-green-600' : 'text-red-600'}>{b.status === 'success' ? '成功' : '失败'}</span>
                                {b.size_bytes && <span>{formatBytes(b.size_bytes)}</span>}
                                {b.status === 'success' && (
                                    <a href={`/api/ops/backups/${b.id}/download`} className="text-orange-600 hover:text-orange-700 font-medium" download>下载</a>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Alert History */}
            {health && health.events.length > 0 && (
                <div>
                    <h4 className="text-xs text-zinc-400 mb-2">告警历史</h4>
                    <div className="space-y-1">
                        {health.events.slice(0, 5).map((e: any) => (
                            <div key={e.id} className="flex items-center gap-2 text-xs text-zinc-600 bg-zinc-50 rounded px-2 py-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${e.severity === 'critical' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                                <span>{e.alert_key}</span>
                                <span className="text-zinc-400">{e.message}</span>
                                <span className="text-zinc-400 ml-auto">{new Date(e.created_at).toLocaleString('zh-CN')}</span>
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
    const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-green-500';
    return (
        <div className="bg-zinc-50 rounded-md p-3">
            <div className="text-xs text-zinc-400 mb-1">{label}</div>
            <div className="text-lg font-semibold text-zinc-800 mb-1">{percent}%</div>
            <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
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
            <div className="space-y-4">
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">磁盘告警阈值 (%)</label>
                    <input
                        type="number"
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        value={config?.monitor?.thresholds?.diskCriticalPercent ?? 90}
                        onChange={e => set('monitor.thresholds.diskCriticalPercent', Number(e.target.value))}
                    />
                </div>
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">备份过期告警 (小时)</label>
                    <input
                        type="number"
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        value={config?.monitor?.thresholds?.backupStaleHours ?? 25}
                        onChange={e => set('monitor.thresholds.backupStaleHours', Number(e.target.value))}
                    />
                </div>
                <hr className="border-zinc-200" />
                <p className="text-xs text-zinc-500 font-medium">SMTP 配置</p>
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">主机</label>
                    <input
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        value={config?.alert?.smtp?.host ?? ''}
                        onChange={e => set('alert.smtp.host', e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">端口</label>
                    <input
                        type="number"
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        value={config?.alert?.smtp?.port ?? 587}
                        onChange={e => set('alert.smtp.port', Number(e.target.value))}
                    />
                </div>
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">发件邮箱</label>
                    <input
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        value={config?.alert?.smtp?.user ?? ''}
                        onChange={e => set('alert.smtp.user', e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">密码/授权码</label>
                    <input
                        type="password"
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        placeholder={config?.alert?.smtp?.password === '***' ? '已加密，留空不变' : ''}
                        onChange={e => set('alert.smtp.password', e.target.value || '***')}
                    />
                </div>
                <div>
                    <label className="block text-xs text-zinc-500 mb-1">收件邮箱</label>
                    <input
                        className="w-full px-2 py-1.5 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
                        value={config?.alert?.smtp?.to ?? ''}
                        onChange={e => set('alert.smtp.to', e.target.value)}
                    />
                </div>
                <div className="flex gap-2 pt-2">
                    <button onClick={handleTestEmail} className="px-3 py-1.5 text-xs bg-zinc-100 rounded hover:bg-zinc-200 transition-colors">发送测试邮件</button>
                    <button onClick={handleSave} className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors">保存配置</button>
                </div>
            </div>
        </Modal>
    );
}
