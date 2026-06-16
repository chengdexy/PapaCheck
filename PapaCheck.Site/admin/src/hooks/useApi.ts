import { useCallback } from 'react';
import { useAuth } from './useAuth';

export function useApi() {
  const { state, logout } = useAuth();

  const fetchApi = useCallback(async <T = any>(url: string, options: RequestInit = {}): Promise<T> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const res = await globalThis.fetch(url, { ...options, headers });
      if (res.status === 401) {
        logout();
        throw new Error('登录已过期，请重新登录');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || `请求失败 (${res.status})`);
      }
      return await res.json();
    } catch (e) {
      if (e instanceof TypeError && e.message === 'Failed to fetch') {
        throw new Error('网络错误，请检查连接');
      }
      throw e;
    }
  }, [state, logout]);

  return { fetch: fetchApi };
}
