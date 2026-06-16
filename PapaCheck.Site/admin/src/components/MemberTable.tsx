import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import LoadingSpinner from './LoadingSpinner';

interface Member {
  id: string;
  nickname: string;
  role: string;
  access_hash: string;
  access_code?: string | null;
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

  async function handleCopy(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      showToast('success', '已复制到剪贴板');
    } catch {
      showToast('error', '复制失败');
    }
  }

  async function handleRegenerate(id: string) {
    if (!confirm('确定重新生成访问码？旧访问码将立即失效。')) return;
    try {
      const result = await apiFetch(`/api/admin/members/${id}/regenerate`, { method: 'POST' });
      showToast('success', `新访问码：${result.access_code}`);
      loadMembers();
    } catch {
      showToast('error', '操作失败');
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('确定移除此成员？此操作不可撤销。')) return;
    try {
      await apiFetch(`/api/admin/members/${id}`, { method: 'DELETE' });
      showToast('success', '已移除');
      loadMembers();
    } catch {
      showToast('error', '移除失败');
    }
  }

  if (loadState === 'loading') {
    return <LoadingSpinner text="加载成员列表..." />;
  }

  if (loadState === 'error') {
    return (
      <div className="text-center py-8 text-zinc-500">
        <p className="mb-2">加载失败</p>
        <button onClick={loadMembers} className="text-orange-600 hover:text-orange-700 text-sm font-medium">重试</button>
      </div>
    );
  }

  if (loadState === 'empty') {
    return <div className="text-center py-8 text-zinc-500"><p>暂无家庭成员</p></div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left">
            <th className="py-3 pr-4 font-medium text-zinc-500">昵称</th>
            <th className="py-3 pr-4 font-medium text-zinc-500">角色</th>
            <th className="py-3 pr-4 font-medium text-zinc-500">访问码</th>
            <th className="py-3 pr-4 font-medium text-zinc-500">最后登录</th>
            <th className="py-3 font-medium text-zinc-500">操作</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id} className="border-b border-zinc-100 hover:bg-zinc-50">
              <td className="py-3 pr-4">{m.nickname}</td>
              <td className="py-3 pr-4">{m.role === 'parent' ? '家长' : '孩子'}</td>
              <td className="py-3 pr-4">
                {m.access_code ? (
                  <>
                    <code className="text-xs bg-zinc-100 px-2 py-0.5 rounded">{m.access_code}</code>
                    <button onClick={() => handleCopy(m.access_code!)} className="ml-2 text-xs text-orange-600 hover:text-orange-700">复制</button>
                  </>
                ) : (
                  <span className="text-xs text-zinc-400">需重新生成</span>
                )}
              </td>
              <td className="py-3 pr-4 text-zinc-400">{m.last_login || '从未'}</td>
              <td className="py-3">
                {m.id !== userId ? (
                  <>
                    <button onClick={() => handleRegenerate(m.id)} className="text-xs text-zinc-600 hover:text-zinc-900 mr-3">重新生成</button>
                    <button onClick={() => handleRemove(m.id)} className="text-xs text-red-600 hover:text-red-700">移除</button>
                  </>
                ) : (
                  <span className="text-xs text-zinc-400">（自己）</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
