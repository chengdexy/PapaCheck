import { useState, type FormEvent } from 'react';
import { Loader2, Plus } from 'lucide-react';
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
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-3 sm:items-end"
    >
      <div className="sm:w-32">
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          角色
        </label>
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="pc-input bg-white cursor-pointer"
        >
          <option value="child">孩子</option>
          <option value="parent">家长</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          昵称
        </label>
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          className="pc-input"
          placeholder="输入昵称"
          required
        />
      </div>
      <button
        type="submit"
        disabled={!nickname.trim() || loading}
        className="pc-btn-primary sm:px-6 py-2.5"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            添加中...
          </>
        ) : (
          <>
            <Plus size={16} />
            添加
          </>
        )}
      </button>
    </form>
  );
}
