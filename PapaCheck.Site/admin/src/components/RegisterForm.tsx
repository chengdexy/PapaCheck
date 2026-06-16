import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

interface Props {
  onRegistered: (accessHash: string) => void;
}

export default function RegisterForm({ onRegistered }: Props) {
  const { state, register } = useAuth();
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const isLoading = state.status === 'loading';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const result = await register(email, password, familyName);
      onRegistered(result.admin_hash);
      setFamilyName('');
      setEmail('');
      setPassword('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const canSubmit = familyName.trim() && email.trim() && password.length >= 6 && !isLoading;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">家庭名称</label>
        <input
          type="text"
          value={familyName}
          onChange={e => setFamilyName(e.target.value)}
          className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm transition-colors"
          placeholder="如：张家"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">邮箱</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm transition-colors"
          placeholder="your@email.com"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">密码</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm transition-colors"
          placeholder="至少6位"
          required
          minLength={6}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-2.5 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? '注册中...' : '注册'}
      </button>
    </form>
  );
}
