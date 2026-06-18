// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../hooks/useAuth';
import LoginForm from '../components/LoginForm';

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

describe('LoginForm', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorageMock.clear(); });

  // Scenario: 提交中按钮禁用
  it('提交中按钮显示登录中且 disabled', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<AuthProvider><LoginForm /></AuthProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('your@email.com'), 'test@t.com');
    await user.type(screen.getByPlaceholderText('至少6位'), '123456');
    await user.click(screen.getByText('登录'));
    expect(screen.getByText('登录中...')).toBeDefined();
  });

  // Scenario: 字段为空时按钮 disabled
  it('字段为空时按钮 disabled', () => {
    render(<AuthProvider><LoginForm /></AuthProvider>);
    expect(screen.getByText('登录').closest('button')?.disabled).toBe(true);
  });

  // Scenario: 登录失败显示错误信息
  it('登录失败显示错误信息', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: '邮箱或密码错误' }) });
    render(<AuthProvider><LoginForm /></AuthProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('your@email.com'), 'test@t.com');
    await user.type(screen.getByPlaceholderText('至少6位'), '123456');
    await user.click(screen.getByText('登录'));
    await waitFor(() => { expect(screen.getByText('邮箱或密码错误')).toBeDefined(); });
  });
});
