import { useState, type FormEvent } from 'react';
import { Key, AlertCircle, Loader2 } from 'lucide-react';
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
    <div className="min-h-[calc(100vh-2rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-brand-fade-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg shadow-violet-100 mb-4 overflow-hidden ring-1 ring-violet-100">
            <Key size={32} className="text-violet-600" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-ink-900)]">首次登录</h1>
          <p className="text-sm text-[var(--color-ink-500)] mt-1">请修改默认凭证以激活账号</p>
        </div>

        <div className="pc-card p-7">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-ink-700)] mb-1.5">
                新邮箱
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
                新密码
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
            {state.error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{state.error}</span>
              </div>
            )}
            <button
              type="submit"
              className="pc-btn-primary w-full py-2.5 mt-1"
              disabled={!email || !password || state.status === 'loading'}
            >
              {state.status === 'loading' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  保存中...
                </>
              ) : (
                '保存并进入'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
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
        <div className="min-h-screen">
          <AppContent />
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
