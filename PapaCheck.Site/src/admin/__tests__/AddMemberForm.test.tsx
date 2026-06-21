// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider } from '../hooks/useAuth';
import { ToastProvider } from '../components/Toast';
import AddMemberForm from '../components/AddMemberForm';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return { getItem: (k: string) => store[k]||null, setItem: (k: string, v: string) => { store[k]=v; }, removeItem: (k: string) => { delete store[k]; }, clear: () => { store={}; } };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

function setupToken() {
  const token = btoa(JSON.stringify({ role: 'parent', sub: 'u1' }));
  localStorageMock.setItem('papacheck_admin_token', `header.${token}.sig`);
}

describe('AddMemberForm', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorageMock.clear(); setupToken(); });

  // Scenario: 昵称为空时按钮 disabled
  it('昵称为空时按钮 disabled', () => {
    render(<AuthProvider><ToastProvider><AddMemberForm onAdded={() => {}} /></ToastProvider></AuthProvider>);
    expect(screen.getByText('添加孩子').closest('button')?.disabled).toBe(true);
  });
});
