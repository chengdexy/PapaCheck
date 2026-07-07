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
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await apiFetch(`${import.meta.env.BASE_URL}api/admin/members`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      showToast('success', `${result.child_name} 的访问码：${result.access_code}`);
      setName('');
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
      <div className="flex-1">
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          孩子姓名
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="pc-input"
          placeholder="输入姓名"
          required
        />
      </div>
      <button
        type="submit"
        disabled={!name.trim() || loading}
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
            添加孩子
          </>
        )}
      </button>
    </form>
  );
}
