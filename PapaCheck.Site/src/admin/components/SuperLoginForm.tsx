import { useState, type FormEvent } from 'react';
import { Key, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function SuperLoginForm() {
  const { state, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const isLoading = state.status === 'loading';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await login(username, password);
  }

  const canSubmit = username.trim() && password && !isLoading;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          用户名
        </label>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="pc-input"
          placeholder="超级管理员用户名"
          required
          autoComplete="username"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          密码
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="pc-input"
          placeholder="超级管理员密码"
          required
          autoComplete="current-password"
        />
      </div>
      {state.error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="pc-btn-secondary w-full py-2.5 mt-1"
      >
        {isLoading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            登录中...
          </>
        ) : (
          <>
            <Key size={16} />
            超级管理员登录
          </>
        )}
      </button>
    </form>
  );
}
