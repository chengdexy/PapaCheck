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
  const payload = btoa(JSON.stringify({ role, sub: 'user-1', tenant_id: 'tenant-1', token_version: 1 }));
  return `header.${payload}.signature`;
}

// Feature: 认证状态管理
//   Scenario: 初始状态为 idle
//     Given 应用已挂载
//     When  首次渲染 AuthProvider
//     Then  status 为 'idle'，token 为 null，role 为 null

//   Scenario: 从 localStorage 恢复已认证状态
//     Given localStorage 中存在有效 token（role 为 'parent' 的 JWT）
//     When  AuthProvider 挂载时调用 checkAuth
//     Then  status 变为 'authenticated'，role 为 'parent'

//   Scenario: 登录成功
//     Given 用户输入正确的邮箱和密码且 API 返回 token
//     When  调用 login(email, password)
//     Then  status 变为 'authenticated'，token 存入 localStorage

//   Scenario: 登录失败
//     Given 用户输入错误的凭证且 API 返回 401
//     When  调用 login(email, password)
//     Then  status 变为 'error'，error 包含错误信息

//   Scenario: 注册成功
//     Given 用户输入邮箱、密码、家庭名称且 API 返回成功
//     When  调用 register(email, password, familyName)
//     Then  返回 { tenant_id, admin_hash }，不自动登录

//   Scenario: 注销
//     Given 当前已认证
//     When  调用 logout()
//     Then  status 变为 'idle'，token 从 localStorage 移除

//   Scenario: API 返回 401 时自动登出
//     Given 当前已认证
//     When  API 返回 401
//     Then  status 变为 'idle'，token 被清除

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
      json: async () => ({ token }),
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

  it('注册成功', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tenant_id: 't1', admin_hash: 'pc-hash' }),
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    let registerResult: any;
    await act(async () => {
      registerResult = await result.current.register('test@test.com', 'password123', '测试家庭');
    });

    expect(registerResult).toEqual({ tenant_id: 't1', admin_hash: 'pc-hash' });
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

  it('superLogin 成功', async () => {
    const token = createValidToken('super_admin');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ token }) });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => { await result.current.superLogin('admin', 'pass'); });
    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.state.role).toBe('super_admin');
  });

  it('superLogin 失败', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: '用户名或密码错误' }) });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => { await result.current.superLogin('admin', 'wrong'); });
    expect(result.current.state.status).toBe('error');
  });

  it('注册失败后 status 回到 idle', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: '邮箱已注册' }) });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await act(async () => {
      try { await result.current.register('a@b.com', '123456', '家庭'); } catch {}
    });
    expect(result.current.state.status).toBe('idle');
  });
});
