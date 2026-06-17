import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function LoginForm() {
  const { state, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isLoading = state.status === 'loading';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await login(email, password);
  }

  const canSubmit = email.trim() && password && !isLoading;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          邮箱
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="pc-input"
          placeholder="your@email.com"
          required
          autoComplete="email"
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
          placeholder="至少6位"
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
        className="pc-btn-primary w-full py-2.5 mt-1"
      >
        {isLoading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            登录中...
          </>
        ) : (
          '登录'
        )}
      </button>
    </form>
  );
}
