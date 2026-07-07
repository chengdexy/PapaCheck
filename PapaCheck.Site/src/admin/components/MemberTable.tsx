import { useState, useEffect, useCallback } from 'react';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import LoadingSpinner from './LoadingSpinner';
import { formatLocalTime } from '../lib/format';

interface Member {
  child_id: string;
  child_name: string;
  is_active: boolean;
  access_code_id: string | null;
  access_code: string | null;
  last_login?: string;
  created_at: string;
}

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export default function MemberTable({ refreshKey }: { refreshKey: number }) {
  const { fetch: apiFetch } = useApi();
  const { state: { userId } } = useAuth();
  const { showToast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const loadMembers = useCallback(async () => {
    setLoadState('loading');
    try {
      const data = await apiFetch('/api/admin/members');
      setMembers(data);
      setLoadState(data.length === 0 ? 'empty' : 'loaded');
    } catch {
      setLoadState('error');
    }
  }, [apiFetch]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers, refreshKey]);

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      showToast('success', '已复制到剪贴板');
    } catch {
      showToast('error', '复制失败');
    }
  }

  async function handleRegenerate(id: string) {
    if (!confirm('确定重新生成访问码？旧访问码将立即失效。')) return;
    try {
      const result = await apiFetch(`${import.meta.env.BASE_URL}api/admin/members/${id}/regenerate`, { method: 'POST' });
      showToast('success', `新访问码：${result.access_code}`);
      loadMembers();
    } catch {
      showToast('error', '操作失败');
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('确定移除此访问码？此操作不可撤销。')) return;
    try {
      await apiFetch(`${import.meta.env.BASE_URL}api/admin/members/${id}`, { method: 'DELETE' });
      showToast('success', '已移除');
      loadMembers();
    } catch {
      showToast('error', '移除失败');
    }
  }

  if (loadState === 'loading') {
    return <LoadingSpinner text="加载孩子列表..." />;
  }

  if (loadState === 'error') {
    return (
      <div className="text-center py-10 text-[var(--color-ink-500)]">
        <p className="mb-3 text-sm">加载失败</p>
        <button onClick={loadMembers} className="pc-link">重试</button>
      </div>
    );
  }

  if (loadState === 'empty') {
    return (
      <div className="text-center py-10 text-[var(--color-ink-500)]">
        <p className="text-sm">暂无孩子</p>
        <p className="text-xs text-[var(--color-ink-400)] mt-1">使用下方表单添加第一个孩子</p>
      </div>
    );
  }

  return (
    <div className="pc-table-wrap overflow-x-auto">
      <table className="pc-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>访问码</th>
            <th>最后登录</th>
            <th className="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.child_id}>
              <td className="font-semibold text-[var(--color-ink-900)]">{m.child_name}</td>
              <td>
                {m.access_code ? (
                  <span className="inline-flex items-center gap-2">
                    <code className="pc-code">{m.access_code}</code>
                    <button
                      onClick={() => handleCopy(m.access_code!)}
                      className="pc-code-copy"
                      aria-label="复制访问码"
                      title="复制访问码"
                    >
                      <Copy size={13} className="inline" />
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-[var(--color-ink-400)] italic">需重新生成</span>
                )}
              </td>
              <td className="text-sm text-[var(--color-ink-500)]">
                {m.last_login ? formatLocalTime(m.last_login) : <span className="text-[var(--color-ink-400)]">从未</span>}
              </td>
              <td className="text-right">
                {m.access_code_id && m.access_code_id !== userId ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => handleRegenerate(m.access_code_id!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--color-ink-600)] hover:text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] rounded-md transition-colors"
                    >
                      <RefreshCw size={12} />
                      重新生成
                    </button>
                    <button
                      onClick={() => handleRemove(m.access_code_id!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                    >
                      <Trash2 size={12} />
                      移除
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--color-ink-400)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
