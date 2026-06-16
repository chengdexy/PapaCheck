import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';

type Role = 'parent' | 'super_admin' | null;

type AuthState = {
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  role: Role;
  userId: string | null;
  token: string | null;
  error: string | null;
};

type AuthAction =
  | { type: 'LOADING' }
  | { type: 'AUTHENTICATED'; token: string | null; role: Role; userId?: string | null }
  | { type: 'ERROR'; error: string }
  | { type: 'LOGOUT' }
  | { type: 'IDLE' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading', error: null };
    case 'AUTHENTICATED':
      return { status: 'authenticated', token: action.token, role: action.role, userId: action.userId ?? null, error: null };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'LOGOUT':
      return { status: 'idle', token: null, role: null, userId: null, error: null };
    case 'IDLE':
      return { status: 'idle', token: null, role: null, userId: null, error: null };
    default:
      return state;
  }
}

const ADMIN_TOKEN_KEY = 'papacheck_admin_token';

function decodeJWT(token: string): { role: Role; userId: string } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }
    return {
      role: payload.role === 'super_admin' ? 'super_admin' : 'parent',
      userId: payload.sub,
    };
  } catch {
    return null;
  }
}

const AuthContext = createContext<{
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, familyName: string) => Promise<{ tenant_id: string; admin_hash: string }>;
  superLogin: (username: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    status: 'loading',
    role: null,
    userId: null,
    token: null,
    error: null,
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
      dispatch({ type: 'AUTHENTICATED', token: data.token, role: 'parent', userId: decoded?.userId });
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
      // Return to idle so the auth view stays visible for the modal
      dispatch({ type: 'IDLE' });
      return { tenant_id: data.tenant_id, admin_hash: data.admin_hash };
    } catch (e) {
      dispatch({ type: 'IDLE' });
      throw e;
    }
  }, []);

  const superLogin = useCallback(async (username: string, password: string) => {
    dispatch({ type: 'LOADING' });
    try {
      const res = await fetch('/api/admin/super/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '登录失败' }));
        throw new Error(err.error || '登录失败');
      }
      const data = await res.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      const decoded = decodeJWT(data.token);
      dispatch({ type: 'AUTHENTICATED', token: data.token, role: 'super_admin', userId: decoded?.userId });
    } catch (e) {
      dispatch({ type: 'ERROR', error: (e as Error).message });
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, register, superLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
