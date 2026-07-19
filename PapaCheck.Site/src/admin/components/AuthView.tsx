import { useState } from 'react';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';

export default function AuthView() {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'register' ? 'register' : 'login';
  });

  return (
    <div className="min-h-[calc(100vh-2rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-brand-fade-up">
        {/* 品牌头 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg shadow-orange-100 mb-4 overflow-hidden ring-1 ring-orange-100">
            <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="PapaCheck" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-ink-900)]">PapaCheck</h1>
          <p className="text-sm text-[var(--color-ink-500)] mt-1">家庭管理面板</p>
        </div>

        {/* 卡片 */}
        <div className="pc-card p-7">
          {/* segmented tab */}
          <div className="pc-segment mb-6" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'login'}
              onClick={() => setActiveTab('login')}
              className={`pc-segment-btn ${activeTab === 'login' ? 'pc-segment-btn--active' : ''}`}
            >
              登录
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'register'}
              onClick={() => setActiveTab('register')}
              className={`pc-segment-btn ${activeTab === 'register' ? 'pc-segment-btn--active' : ''}`}
            >
              注册
            </button>
          </div>

          {activeTab === 'login' ? <LoginForm /> : <RegisterForm />}
        </div>

        <p className="text-center text-xs text-[var(--color-ink-400)] mt-6">
          © PapaCheck · 让家庭协作更轻松
        </p>
      </div>
    </div>
  );
}
