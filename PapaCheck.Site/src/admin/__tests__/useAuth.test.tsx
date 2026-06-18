// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../hooks/useAuth';

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock localStorage
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

function createValidToken(role: string = 'parent') {
  const payload = btoa(JSON.stringify({ role, sub: 'user-1', tenant_id: 'tenant-1', token_version: 1, exp: 9999999999 }));
  return `header.${payload}.signature`;
}

// Feature: 认证状态管理

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('初始状态为 idle', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.token).toBeNull();
    expect(result.current.state.role).toBeNull();
  });

  it('从 localStorage 恢复已认证状态', () => {
    const token = createValidToken('parent');
    localStorageMock.setItem('papacheck_admin_token', token);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.state.role).toBe('parent');
    expect(result.current.state.token).toBe(token);
  });

  it('登录成功', async () => {
    const token = createValidToken('parent');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token, role: 'parent' }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => {
      await result.current.login('test@test.com', 'password123');
    });

    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.state.role).toBe('parent');
    expect(localStorageMock.getItem('papacheck_admin_token')).toBe(token);
  });

  it('登录失败', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: '邮箱或密码错误' }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => {
      await result.current.login('test@test.com', 'wrong');
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('邮箱或密码错误');
  });

  it('注册成功并自动登录', async () => {
    const token = createValidToken('user');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token, role: 'user' }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    let registerResult: any;
    await act(async () => {
      registerResult = await result.current.register('test@test.com', 'password123', '测试家庭');
    });

    // register now returns {} and auto-logs in
    expect(registerResult).toEqual({});
    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.state.role).toBe('user');
    expect(localStorageMock.getItem('papacheck_admin_token')).toBe(token);
  });

  it('注册失败后 status 回到 idle', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: '邮箱已注册' }) });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => {
      try { await result.current.register('a@b.com', '123456', '家庭'); } catch {}
    });
    expect(result.current.state.status).toBe('idle');
  });

  it('注销', () => {
    const token = createValidToken('parent');
    localStorageMock.setItem('papacheck_admin_token', token);

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => { result.current.logout(); });

    expect(result.current.state.status).toBe('idle');
    expect(localStorageMock.getItem('papacheck_admin_token')).toBeNull();
  });

  it('注销后 token 被清除', () => {
    const token = createValidToken('parent');
    localStorageMock.setItem('papacheck_admin_token', token);

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    act(() => { result.current.logout(); });

    expect(result.current.state.token).toBeNull();
    expect(result.current.state.status).toBe('idle');
  });
});
