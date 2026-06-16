import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../hooks/useAuth';
import RegisterForm from '../components/RegisterForm';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] || null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('RegisterForm', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorageMock.clear(); });

  // Scenario: 字段为空时按钮禁止提交
  it('字段为空时按钮 disabled', () => {
    render(<AuthProvider><RegisterForm onRegistered={() => {}} /></AuthProvider>);
    expect(screen.getByText('注册').closest('button')?.disabled).toBe(true);
  });

  // Scenario: 密码不足 6 位时按钮 disabled（注册仍可点但密码长度 < 6 为 disabled）
  it('密码不足6位时按钮 disabled', async () => {
    render(<AuthProvider><RegisterForm onRegistered={() => {}} /></AuthProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('如：张家'), '张');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('至少6位'), '12345');
    expect(screen.getByText('注册').closest('button')?.disabled).toBe(true);
  });

  // Scenario: 注册成功回调
  it('注册成功调用 onRegistered 回调', async () => {
    const onRegistered = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ tenant_id: 't1', admin_hash: 'pc-hash' }) });
    render(<AuthProvider><RegisterForm onRegistered={onRegistered} /></AuthProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('如：张家'), '张家');
    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('至少6位'), '123456');
    await user.click(screen.getByText('注册'));
    await waitFor(() => { expect(onRegistered).toHaveBeenCalledWith('pc-hash'); });
  });
});
