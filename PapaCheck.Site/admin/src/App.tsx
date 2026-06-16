import { useState, type FormEvent } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/Toast';
import AuthView from './components/AuthView';
import Dashboard from './components/Dashboard';
import SuperDashboard from './components/SuperDashboard';
import LoadingSpinner from './components/LoadingSpinner';

function ChangeCredentialsView() {
  const { updateCredentials, state } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await updateCredentials(email, password);
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <h2 className="text-xl font-semibold text-zinc-900 mb-6">首次登录：请修改凭证</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">新邮箱</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
            placeholder="your@email.com"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">新密码</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-3 py-2 border-b border-zinc-300 focus:border-orange-500 outline-none text-sm"
            placeholder="至少6位"
            required
            minLength={6}
          />
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          className="w-full py-2.5 bg-zinc-800 text-white rounded-md text-sm font-medium hover:bg-zinc-900 disabled:opacity-50"
          disabled={!email || !password || state.status === 'loading'}
        >
          {state.status === 'loading' ? '保存中...' : '保存并进入'}
        </button>
      </form>
    </div>
  );
}

function AppContent() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <LoadingSpinner text="请稍候..." />
      </div>
    );
  }

  if (state.status === 'idle' || (state.status === 'error' && !state.token)) {
    return <AuthView />;
  }

  // 超级管理员首次登录：需要修改凭证
  if (state.role === 'admin' && state.needsPasswordChange) {
    return <ChangeCredentialsView />;
  }

  // 超级管理员面板
  if (state.role === 'admin') return <SuperDashboard />;

  // 用户账号面板
  if (state.role === 'user') return <Dashboard />;

  // 其他（旧兼容）
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <div className="min-h-screen bg-zinc-50">
          <AppContent />
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
