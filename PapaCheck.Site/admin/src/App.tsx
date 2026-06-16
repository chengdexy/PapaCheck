import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/Toast';
import AuthView from './components/AuthView';
import Dashboard from './components/Dashboard';
import SuperDashboard from './components/SuperDashboard';
import Modal from './components/Modal';
import LoadingSpinner from './components/LoadingSpinner';

function AppContent() {
  const { state } = useAuth();
  const [accessHash, setAccessHash] = useState<string | null>(null);

  // Loading state during auth check or API calls
  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <LoadingSpinner text="请稍候..." />
      </div>
    );
  }

  // Unauthenticated or registration callback
  if (state.status === 'idle' || (state.status === 'error' && !state.token)) {
    return (
      <>
        <AuthView onRegistered={hash => setAccessHash(hash)} />
        <Modal open={!!accessHash} title="注册成功" onClose={() => setAccessHash(null)}>
          <p>家庭已创建。</p>
          <p className="mt-2">
            管理员的访问码是：
            <code className="block mt-1 p-2 bg-zinc-100 rounded text-sm font-mono break-all">{accessHash}</code>
          </p>
          <p className="mt-2 text-zinc-500 text-xs">请务必保存此访问码！</p>
        </Modal>
      </>
    );
  }

  if (state.role === 'super_admin') return <SuperDashboard />;
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
