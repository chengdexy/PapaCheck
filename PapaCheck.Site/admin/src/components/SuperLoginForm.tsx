import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function SuperLoginForm() {
  const { state, superLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const isLoading = state.status === 'loading';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await superLogin(username, password);
  }

  const canSubmit = username.trim() && password && !isLoading;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">用户名</label>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm transition-colors"
          placeholder="超级管理员用户名"
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
          placeholder="超级管理员密码"
          required
        />
      </div>
      {state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-2.5 bg-zinc-800 text-white rounded-md text-sm font-medium hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? '登录中...' : '超级管理员登录'}
      </button>
    </form>
  );
}
