import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../components/Toast';
import MemberTable from '../components/MemberTable';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return { getItem: (k: string) => store[k]||null, setItem: (k: string, v: string) => { store[k]=v; }, removeItem: (k: string) => { delete store[k]; }, clear: () => { store={}; } };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function setup() {
  const token = btoa(JSON.stringify({ role: 'parent', sub: 'u1', tenant_id: 't1', token_version: 1 }));
  localStorageMock.setItem('papacheck_admin_token', `header.${token}.sig`);
}

describe('MemberTable', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorageMock.clear(); setup(); });

  // Scenario: 加载中显示骨架屏
  it('加载中显示 loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<AuthProvider><ToastProvider><MemberTable refreshKey={0} /></ToastProvider></AuthProvider>);
    expect(screen.getByText('加载成员列表...')).toBeDefined();
  });

  // Scenario: 加载失败显示重试
  it('加载失败显示重试', async () => {
    mockFetch.mockRejectedValue(new Error('fail'));
    await act(async () => {
      render(<AuthProvider><ToastProvider><MemberTable refreshKey={0} /></ToastProvider></AuthProvider>);
    });
    await waitFor(() => { expect(screen.getByText('重试')).toBeDefined(); }, { timeout: 3000 });
  });

  // Scenario: 空列表显示提示
  it('空列表显示暂无家庭成员', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    await act(async () => {
      render(<AuthProvider><ToastProvider><MemberTable refreshKey={0} /></ToastProvider></AuthProvider>);
    });
    await waitFor(() => { expect(screen.getByText('暂无家庭成员')).toBeDefined(); }, { timeout: 3000 });
  });

  // Scenario: 加载成功显示成员列表
  it('加载成功显示成员列表', async () => {
    const members = [
      { id: '1', nickname: '爸爸', role: 'parent', access_hash: 'abc123', last_login: '2024-01-01', created_at: '2024-01-01' },
      { id: '2', nickname: '小明', role: 'child', access_hash: 'def456', last_login: null, created_at: '2024-01-02' },
    ];
    mockFetch.mockResolvedValue({ ok: true, json: async () => members });
    await act(async () => {
      render(<AuthProvider><ToastProvider><MemberTable refreshKey={0} /></ToastProvider></AuthProvider>);
    });
    await waitFor(() => { expect(screen.getByText('爸爸')).toBeDefined(); }, { timeout: 3000 });
    expect(screen.getByText('小明')).toBeDefined();
  });
});
