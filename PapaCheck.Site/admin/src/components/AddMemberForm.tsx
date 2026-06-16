import { useState, type FormEvent } from 'react';
import { useApi } from '../hooks/useApi';
import { useToast } from './Toast';

interface Props {
  onAdded: () => void;
}

export default function AddMemberForm({ onAdded }: Props) {
  const { fetch: apiFetch } = useApi();
  const { showToast } = useToast();
  const [role, setRole] = useState('child');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await apiFetch('/api/admin/members', {
        method: 'POST',
        body: JSON.stringify({ role, nickname }),
      });
      showToast('success', `${result.nickname} 的访问码：${result.access_hash}`);
      setNickname('');
      onAdded();
    } catch {
      showToast('error', '添加失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 items-end">
      <div className="flex-1">
        <label className="block text-sm font-medium text-zinc-700 mb-1">角色</label>
        <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm bg-transparent">
          <option value="child">孩子</option>
          <option value="parent">家长</option>
        </select>
      </div>
      <div className="flex-[2]">
        <label className="block text-sm font-medium text-zinc-700 mb-1">昵称</label>
        <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm" placeholder="输入昵称" required />
      </div>
      <button type="submit" disabled={!nickname.trim() || loading} className="px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
        {loading ? '添加中...' : '添加'}
      </button>
    </form>
  );
}
