import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function RegisterForm() {
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
      await register(email, password, familyName);
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
        <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
          家庭名称
        </label>
        <input
          type="text"
          value={familyName}
          onChange={e => setFamilyName(e.target.value)}
          className="pc-input"
          placeholder="如：张家"
          required
          autoComplete="off"
        />
      </div>
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
          minLength={6}
          autoComplete="new-password"
        />
      </div>
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
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
            注册中...
          </>
        ) : (
          '注册'
        )}
      </button>
    </form>
  );
}
