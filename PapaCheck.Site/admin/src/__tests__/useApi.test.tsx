import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { useApi } from '../hooks/useApi';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('useApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  // Feature: API 调用封装
  //   Scenario: 自动注入 Authorization header
  //     Given token 存在（通过 AuthProvider）
  //     When  调用 useApi 的 fetch 方法
  //     Then  请求头包含 Authorization: Bearer <token>

  it('自动注入 Authorization header', async () => {
    const token = btoa(JSON.stringify({ role: 'parent', sub: 'u1' }));
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: `header.${token}.sig` }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: 'ok' }) });

    const { result } = renderHook(() => {
      const auth = useAuth();
      const api = useApi();
      return { auth, api };
    }, { wrapper: AuthProvider });

    await act(async () => {
      await result.current.auth.login('test@test.com', 'pass');
    });

    await act(async () => {
      await result.current.api.fetch('/api/admin/members');
    });

    const calls = mockFetch.mock.calls;
    const apiCall = calls[calls.length - 1];
    const headers = apiCall[1]?.headers as Record<string, string> || {};
    expect(headers['Authorization']).toBe(`Bearer ${result.current.auth.state.token}`);
  });

  //   Scenario: 401 响应自动登出
  //     Given API 返回 401
  //     When  调用 fetch
  //     Then  抛出错误且 auth state 变为 idle

  it('401 响应自动登出', async () => {
    const token = btoa(JSON.stringify({ role: 'parent', sub: 'u1' }));
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: `header.${token}.sig` }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    const { result } = renderHook(() => {
      const auth = useAuth();
      const api = useApi();
      return { auth, api };
    }, { wrapper: AuthProvider });

    await act(async () => {
      await result.current.auth.login('test@test.com', 'pass');
    });

    await act(async () => {
      try {
        await result.current.api.fetch('/api/admin/members');
      } catch {}
    });

    expect(result.current.auth.state.status).toBe('idle');
  });

  //   Scenario: 网络错误转为中文提示
  //     Given fetch 抛出网络错误
  //     When  调用 fetch
  //     Then  错误信息为"网络错误，请检查连接"

  it('网络错误转为中文提示', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => {
      const auth = useAuth();
      const api = useApi();
      return { auth, api };
    }, { wrapper: AuthProvider });

    let error: Error | null = null as Error | null;
    await act(async () => {
      try {
        await result.current.api.fetch('/api/test');
      } catch (e) {
        error = e as Error;
      }
    });

    expect(error?.message).toBe('网络错误，请检查连接');
  });

  // Scenario: 非401错误抛出服务器错误信息
  it('非401错误抛出服务器错误信息', async () => {
    const token = btoa(JSON.stringify({ role: 'parent', sub: 'u1' }));
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: `header.${token}.sig` }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: '服务器内部错误' }) });

    const { result } = renderHook(() => {
      const auth = useAuth();
      const api = useApi();
      return { auth, api };
    }, { wrapper: AuthProvider });

    await act(async () => {
      await result.current.auth.login('t@t.com', 'pass');
    });

    let error: Error | null = null;
    await act(async () => {
      try { await result.current.api.fetch('/api/test'); } catch(e) { error = e as Error; }
    });
    expect(error?.message).toBe('服务器内部错误');
  });
});
