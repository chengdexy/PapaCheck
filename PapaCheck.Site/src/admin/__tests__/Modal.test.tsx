// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../components/Modal';

// Feature: Modal 弹窗
//   Scenario: 显示标题和内容
it('显示标题和内容', () => {
  render(
    <Modal open={true} title="注册成功" onClose={() => {}}>
      <p>访问码是 pc-xxx</p>
    </Modal>
  );
  expect(screen.getByText('注册成功')).toBeDefined();
  expect(screen.getByText('访问码是 pc-xxx')).toBeDefined();
  expect(screen.getByText('确定')).toBeDefined();
});

//   Scenario: 点击确定关闭
it('点击确定调用 onClose', async () => {
  const onClose = vi.fn();
  render(
    <Modal open={true} title="提示" onClose={onClose}>
      <p>内容</p>
    </Modal>
  );
  await userEvent.setup().click(screen.getByText('确定'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

//   Scenario: 默认不显示
it('open=false 时不显示', () => {
  render(
    <Modal open={false} title="隐藏" onClose={() => {}}>
      <p>不可见</p>
    </Modal>
  );
  expect(screen.queryByText('隐藏')).toBeNull();
});
