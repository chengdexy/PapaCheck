import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
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
      <div className="text-center py-8 text-zinc-500">
        <p className="mb-2">加载失败</p>
        <button onClick={loadTenants} className="text-orange-600 hover:text-orange-700 text-sm font-medium">重试</button>
      </div>
    );
  }

  if (loadState === 'empty') return <div className="text-center py-8 text-zinc-500"><p>暂无家庭</p></div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left">
            <th className="py-3 pr-4 font-medium text-zinc-500">家庭名称</th>
            <th className="py-3 pr-4 font-medium text-zinc-500">成员数</th>
            <th className="py-3 pr-4 font-medium text-zinc-500">状态</th>
            <th className="py-3 pr-4 font-medium text-zinc-500">创建时间</th>
            <th className="py-3 font-medium text-zinc-500">操作</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id} className="border-b border-zinc-100 hover:bg-zinc-50">
              <td className="py-3 pr-4">{t.name}</td>
              <td className="py-3 pr-4">{t.member_count}</td>
              <td className="py-3 pr-4">
                <span className={t.is_active ? 'text-green-600' : 'text-zinc-400'}>
                  {t.is_active ? '启用' : '禁用'}
                </span>
              </td>
              <td className="py-3 pr-4 text-zinc-400">{t.created_at || '-'}</td>
              <td className="py-3">
                {t.is_active ? (
                  <button onClick={() => handleToggle(t.id, false)} className="text-xs text-red-600 hover:text-red-700">禁用</button>
                ) : (
                  <button onClick={() => handleToggle(t.id, true)} className="text-xs text-green-600 hover:text-green-700">启用</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
