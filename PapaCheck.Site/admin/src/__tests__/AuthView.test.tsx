import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../hooks/useAuth';
import AuthView from '../components/AuthView';

describe('AuthView', () => {
  // Scenario: 默认显示登录标签页
  it('默认显示登录标签页', () => {
    render(<AuthProvider><AuthView onRegistered={() => {}} /></AuthProvider>);
    // Both the tab and the form submit button contain "登录"
    const loginButtons = screen.getAllByText('登录');
    expect(loginButtons.length).toBe(2);
    // Confirm register form is NOT showing
    expect(screen.queryByPlaceholderText('如：张家')).toBeNull();
  });

  // Scenario: 切换到注册标签
  it('切换到注册标签', async () => {
    render(<AuthProvider><AuthView onRegistered={() => {}} /></AuthProvider>);
    await userEvent.setup().click(screen.getByText('注册'));
    expect(screen.getByPlaceholderText('如：张家')).toBeDefined();
  });

  // Scenario: 点击超管登录切换显示
  it('点击超管登录显示超管表单', async () => {
    render(<AuthProvider><AuthView onRegistered={() => {}} /></AuthProvider>);
    await userEvent.setup().click(screen.getByText('超级管理员登录'));
    expect(screen.getByPlaceholderText('超级管理员用户名')).toBeDefined();
  });

  // Scenario: 从注册切换回登录
  it('从注册切换回登录', async () => {
    render(<AuthProvider><AuthView onRegistered={() => {}} /></AuthProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByText('注册'));
    await user.click(screen.getByText('登录'));
    expect(screen.queryByPlaceholderText('如：张家')).toBeNull();
    expect(screen.getByPlaceholderText('your@email.com')).toBeDefined();
  });

  // Scenario: 从超管视图返回普通登录
  it('从超管视图返回普通登录', async () => {
    render(<AuthProvider><AuthView onRegistered={() => {}} /></AuthProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByText('超级管理员登录'));
    expect(screen.getByPlaceholderText('超级管理员用户名')).toBeDefined();
    await user.click(screen.getByText('返回普通登录'));
    expect(screen.getByPlaceholderText('your@email.com')).toBeDefined();
  });
});
