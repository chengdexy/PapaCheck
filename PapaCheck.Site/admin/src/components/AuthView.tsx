import { useState } from 'react';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import SuperLoginForm from './SuperLoginForm';

interface Props {
  onRegistered: (accessHash: string) => void;
}

export default function AuthView({ onRegistered }: Props) {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [showSuper, setShowSuper] = useState(false);

  return (
    <div className="max-w-sm mx-auto mt-20">
      <div className="flex border-b border-zinc-200 mb-6">
        <button
          onClick={() => setActiveTab('login')}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'login'
              ? 'border-orange-500 text-orange-600'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          登录
        </button>
        <button
          onClick={() => setActiveTab('register')}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'register'
              ? 'border-orange-500 text-orange-600'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          注册
        </button>
      </div>

      {showSuper ? (
        <>
          <SuperLoginForm />
          <button
            onClick={() => setShowSuper(false)}
            className="mt-3 text-sm text-zinc-500 hover:text-zinc-700"
          >
            返回普通登录
          </button>
        </>
      ) : (
        <>
          {activeTab === 'login' ? <LoginForm /> : <RegisterForm onRegistered={onRegistered} />}
          <button
            onClick={() => setShowSuper(true)}
            className="mt-3 text-sm text-zinc-400 hover:text-zinc-600"
          >
            超级管理员登录
          </button>
        </>
      )}
    </div>
  );
}
