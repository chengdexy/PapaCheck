import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/Toast';

function TestComponent({ onShow }: { onShow: (show: (type: 'success' | 'error', msg: string) => void) => void }) {
  const { showToast } = useToast();
  return <button onClick={() => onShow(showToast)}>Show Toast</button>;
}

// Feature: Toast 轻提示
//   Scenario: 显示成功提示
//     Given ToastProvider 已挂载
//     When  调用 showToast('success', '操作成功')
//     Then  页面上显示"操作成功"的成功提示
it('显示成功提示', () => {
  render(
    <ToastProvider>
      <TestComponent onShow={(show) => show('success', '操作成功')} />
    </ToastProvider>
  );
  act(() => { screen.getByText('Show Toast').click(); });
  expect(screen.getByText('操作成功')).toBeDefined();
});

//   Scenario: 显示错误提示
//     Given ToastProvider 已挂载
//     When  调用 showToast('error', '操作失败')
//     Then  页面上显示"操作失败"的错误提示
it('显示错误提示', () => {
  render(
    <ToastProvider>
      <TestComponent onShow={(show) => show('error', '操作失败')} />
    </ToastProvider>
  );
  act(() => { screen.getByText('Show Toast').click(); });
  expect(screen.getByText('操作失败')).toBeDefined();
});

//   Scenario: 点击关闭按钮消失
//     Given 页面上已显示一条 Toast 提示
//     When  点击关闭按钮（×）
//     Then  Toast 从页面上消失
it('点击关闭按钮消失', () => {
  render(
    <ToastProvider>
      <TestComponent onShow={(show) => show('success', '消息')} />
    </ToastProvider>
  );
  act(() => { screen.getByText('Show Toast').click(); });
  const btn = screen.getByText('×');
  act(() => { btn.click(); });
  expect(screen.queryByText('消息')).toBeNull();
});
