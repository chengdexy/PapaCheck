import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';

type Role = 'parent' | 'super_admin' | 'admin' | 'user' | null;

type AuthState = {
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  role: Role;
  userId: string | null;
  token: string | null;
  error: string | null;
  needsPasswordChange: boolean;
};

type AuthAction =
  | { type: 'LOADING' }
  | { type: 'AUTHENTICATED'; token: string | null; role: Role; userId?: string | null; needsPasswordChange?: boolean }
  | { type: 'ERROR'; error: string }
  | { type: 'LOGOUT' }
  | { type: 'IDLE' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading', error: null };
    case 'AUTHENTICATED':
      return {
        ...state,
        status: 'authenticated',
        token: action.token,
        role: action.role,
        userId: action.userId ?? null,
        error: null,
        needsPasswordChange: action.needsPasswordChange ?? false,
      };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'LOGOUT':
      return { status: 'idle', token: null, role: null, userId: null, error: null, needsPasswordChange: false };
    case 'IDLE':
      return { status: 'idle', token: null, role: null, userId: null, error: null, needsPasswordChange: false };
    default:
      return state;
  }
}

const ADMIN_TOKEN_KEY = 'papacheck_admin_token';

function decodeJWT(token: string): { role: Role; userId: string } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }
    // 直接使用 payload 中的 role
    return { role: payload.role, userId: payload.sub };
  } catch {
    return null;
  }
}

const AuthContext = createContext<{
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, familyName: string) => Promise<any>;
  updateCredentials: (email: string, password: string, currentPassword?: string) => Promise<void>;
  logout: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    status: 'loading',
    role: null,
    userId: null,
    token: null,
    error: null,
    needsPasswordChange: false,
  });

  const checkAuth = useCallback(() => {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) {
      const decoded = decodeJWT(token);
      if (decoded) {
        dispatch({ type: 'AUTHENTICATED', token, role: decoded.role, userId: decoded.userId });
      } else {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        dispatch({ type: 'IDLE' });
      }
    } else {
      dispatch({ type: 'IDLE' });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'LOADING' });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '登录失败' }));
        throw new Error(err.error || '登录失败');
      }
      const data = await res.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      const decoded = decodeJWT(data.token);
      dispatch({
        type: 'AUTHENTICATED',
        token: data.token,
        role: data.role,
        userId: decoded?.userId,
        needsPasswordChange: data.needs_password_change ?? false,
      });
    } catch (e) {
      dispatch({ type: 'ERROR', error: (e as Error).message });
    }
  }, []);

  const register = useCallback(async (email: string, password: string, familyName: string) => {
    dispatch({ type: 'LOADING' });
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, family_name: familyName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '注册失败' }));
        throw new Error(err.error || '注册失败');
      }
      const data = await res.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      const decoded = decodeJWT(data.token);
      dispatch({
        type: 'AUTHENTICATED',
        token: data.token,
        role: 'user',
        userId: decoded?.userId,
      });
      return {}; // 不再返回 tenant_id 和 admin_hash
    } catch (e) {
      dispatch({ type: 'IDLE' });
      throw e;
    }
  }, []);

  const updateCredentials = useCallback(async (email: string, password: string, currentPassword?: string) => {
    dispatch({ type: 'LOADING' });
    try {
      const res = await fetch('/api/auth/credentials', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem(ADMIN_TOKEN_KEY)}`,
        },
        body: JSON.stringify({
          email,
          password,
          ...(currentPassword ? { current_password: currentPassword } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '修改失败' }));
        throw new Error(err.error || '修改失败');
      }
      // 修改成功后重新登录
      await login(email, password);
    } catch (e) {
      dispatch({ type: 'ERROR', error: (e as Error).message });
    }
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    // 同时清理孩子端/家长端的 sessionStorage token，防止退出后访问 /login.html
    // 时被旧 token 自动重定向到孩子/家长页面展示旧数据
    sessionStorage.removeItem('papacheck_token');
    sessionStorage.removeItem('papacheck_role');
    sessionStorage.removeItem('papacheck_child_name');
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, register, updateCredentials, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
