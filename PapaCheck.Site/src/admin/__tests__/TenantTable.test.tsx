// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../components/Toast';
import TenantTable from '../components/TenantTable';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return { getItem: (k: string) => store[k]||null, setItem: (k: string, v: string) => { store[k]=v; }, removeItem: (k: string) => { delete store[k]; }, clear: () => { store={}; } };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function setupToken() {
  const token = btoa(JSON.stringify({ role: 'super_admin', sub: 'admin', token_version: 1 }));
  localStorageMock.setItem('papacheck_admin_token', `header.${token}.sig`);
}

describe('TenantTable', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorageMock.clear(); setupToken(); });

  // Scenario: 加载中显示 loading
  it('加载中显示 loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<AuthProvider><ToastProvider><TenantTable /></ToastProvider></AuthProvider>);
    expect(screen.getByText('加载家庭列表...')).toBeDefined();
  });

  // Scenario: 加载失败显示重试
  it('加载失败显示重试', async () => {
    mockFetch.mockRejectedValue(new Error('fail'));
    render(<AuthProvider><ToastProvider><TenantTable /></ToastProvider></AuthProvider>);
    await waitFor(() => { expect(screen.getByText('重试')).toBeDefined(); });
  });

  // Scenario: 空列表显示提示
  it('空列表显示暂无家庭', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    render(<AuthProvider><ToastProvider><TenantTable /></ToastProvider></AuthProvider>);
    await waitFor(() => { expect(screen.getByText('暂无家庭')).toBeDefined(); });
  });

  // Scenario: 加载成功显示家庭列表
  it('加载成功显示家庭列表', async () => {
    const tenants = [
      { id: '1', name: '张家', member_count: 3, is_active: true, created_at: '2024-01-01' },
      { id: '2', name: '李家', member_count: 1, is_active: false, created_at: '2024-02-01' },
    ];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => tenants });
    render(<AuthProvider><ToastProvider><TenantTable /></ToastProvider></AuthProvider>);
    await waitFor(() => { expect(screen.getByText('张家')).toBeDefined(); });
    expect(screen.getByText('李家')).toBeDefined();
  });
});
