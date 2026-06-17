import { useState, useEffect, useCallback } from 'react';
import { Home, Users } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useToast } from './Toast';
import LoadingSpinner from './LoadingSpinner';

interface Tenant {
  id: string;
  name: string;
  member_count: number;
  is_active: boolean;
  created_at?: string;
}

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export default function TenantTable() {
  const { fetch: apiFetch } = useApi();
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const loadTenants = useCallback(async () => {
    setLoadState('loading');
    try {
      const data = await apiFetch('/api/admin/super/tenants');
      setTenants(data);
      setLoadState(data.length === 0 ? 'empty' : 'loaded');
    } catch {
      setLoadState('error');
    }
  }, [apiFetch]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  async function handleToggle(tenantId: string, isActive: boolean) {
    const action = isActive ? '启用' : '禁用';
    if (!confirm(`确定${action}该家庭？`)) return;
    try {
      await apiFetch(`/api/admin/super/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: isActive }),
      });
      showToast('success', `已${action}`);
      loadTenants();
    } catch {
      showToast('error', '操作失败');
    }
  }

  if (loadState === 'loading') return <LoadingSpinner text="加载家庭列表..." />;

  if (loadState === 'error') {
    return (
      <div className="text-center py-10 text-[var(--color-ink-500)]">
        <p className="mb-3 text-sm">加载失败</p>
        <button onClick={loadTenants} className="pc-link">重试</button>
      </div>
    );
  }

  if (loadState === 'empty') {
    return (
      <div className="text-center py-10 text-[var(--color-ink-500)]">
        <p className="text-sm">暂无家庭</p>
      </div>
    );
  }

  return (
    <div className="pc-table-wrap overflow-x-auto">
      <table className="pc-table">
        <thead>
          <tr>
            <th>家庭名称</th>
            <th>成员数</th>
            <th>状态</th>
            <th>创建时间</th>
            <th className="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id}>
              <td className="font-semibold text-[var(--color-ink-900)]">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-orange-100 text-orange-600">
                    <Home size={14} />
                  </span>
                  {t.name}
                </span>
              </td>
              <td>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--color-ink-100)] text-[var(--color-ink-700)] text-xs font-semibold">
                  <Users size={12} />
                  {t.member_count}
                </span>
              </td>
              <td>
                <span
                  className={`pc-badge ${
                    t.is_active ? 'pc-badge-active' : 'pc-badge-inactive'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      t.is_active ? 'bg-emerald-500' : 'bg-[var(--color-ink-400)]'
                    }`}
                  />
                  {t.is_active ? '启用' : '禁用'}
                </span>
              </td>
              <td className="text-sm text-[var(--color-ink-500)]">
                {t.created_at || <span className="text-[var(--color-ink-400)]">-</span>}
              </td>
              <td className="text-right">
                {t.is_active ? (
                  <button
                    onClick={() => handleToggle(t.id, false)}
                    className="px-2.5 py-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                  >
                    禁用
                  </button>
                ) : (
                  <button
                    onClick={() => handleToggle(t.id, true)}
                    className="px-2.5 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors"
                  >
                    启用
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
