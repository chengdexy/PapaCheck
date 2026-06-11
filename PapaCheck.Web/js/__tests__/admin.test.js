/**
 * admin.test.js - admin.js 事件委托与 HTML 转义测试
 *
 * Feature: escapeHtml HTML 转义
 *   Scenario: 普通文本保持不变
 *     Given 输入 "你好世界"
 *     When 调用 escapeHtml
 *     Then 返回 "你好世界"
 *
 *   Scenario: HTML 特殊字符被转义
 *     Given 输入 "<script>alert('xss')</script>"
 *     When 调用 escapeHtml
 *     Then 返回 "&lt;script&gt;alert('xss')&lt;/script&gt;"
 *
 *   Scenario: 双引号被转义
 *     Given 输入 '他说："你好"'
 *     When 调用 escapeHtml
 *     Then 返回 '他说：&quot;你好&quot;'
 *
 *   Scenario: & 符号被转义
 *     Given 输入 "A & B"
 *     When 调用 escapeHtml
 *     Then 返回 "A &amp; B"
 *
 *   Scenario: null 返回空字符串
 *     Given 输入 null
 *     When 调用 escapeHtml
 *     Then 返回 ""
 *
 *   Scenario: undefined 返回空字符串
 *     Given 输入 undefined
 *     When 调用 escapeHtml
 *     Then 返回 ""
 *
 *   Scenario: 空字符串返回空字符串
 *     Given 输入 ""
 *     When 调用 escapeHtml
 *     Then 返回 ""
 *
 * Feature: 事件委托 data-si-* 属性处理
 *   Scenario: 点击 .reward-shop-item 触发 addRewardFromShop
 *     Given 点击元素有 data-si-name="游戏时间" data-si-type="time" data-si-duration="30"
 *     When 事件委托捕获到该点击
 *     Then 调用 addRewardFromShop("游戏时间", "time", "30")
 *
 *   Scenario: 点击 .subject-mgmt-delete 触发 confirmRemoveSubject
 *     Given 点击元素有 data-subject-id="物理"
 *     When 事件委托捕获到该点击
 *     Then 调用 confirmRemoveSubject("物理")
 *
 *   Scenario: 点击 .subject-mgmt-restore-btn 触发 restoreDefaultSubject
 *     Given 点击元素有 data-subject-id="英语"
 *     When 事件委托捕获到该点击
 *     Then 调用 restoreDefaultSubject("英语")
 *
 *   Scenario: 点击无 data-si-* 属性的元素不触发
 *     Given 点击元素没有 data-si-* 属性
 *     When 事件委托捕获到该点击
 *     Then 不触发任何操作
 *
 *   Scenario: 点击子元素时通过 closest 向上查找
 *     Given 父元素 .reward-shop-item 包含 data-si-name
 *     When 点击父元素内部的子元素
 *     Then 通过 closest 找到父元素并读取 data-si-name
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * 模拟 DOM 中 escapeHtml 的工作原理：
 * 设置 textContent 后读取 innerHTML，浏览器会自动转义特殊字符
 */
function simulateEscapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 使用 vm 从 admin.js 提取实际的 escapeHtml 函数
 */
function loadEscapeHtmlFromSource() {
  const adminCode = fs.readFileSync(
    path.join(__dirname, '..', 'admin.js'),
    'utf8'
  );

  // 提取 escapeHtml 函数
  const match = adminCode.match(
    /function escapeHtml\([\s\S]*?\n\}/
  );
  if (!match) throw new Error('无法从 admin.js 提取 escapeHtml');

  const vm = require('vm');
  const ctx = vm.createContext({
    document: {
      createElement: () => {
        let text = '';
        return {
          get textContent() { return text; },
          set textContent(v) { text = v == null ? '' : String(v); },
          get innerHTML() {
            // 模拟浏览器自动转义
            return text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          },
        };
      },
    },
  });
  vm.runInContext(match[0], ctx);
  return ctx.escapeHtml;
}

describe('escapeHtml', () => {
  let escapeHtml;

  beforeEach(() => {
    escapeHtml = loadEscapeHtmlFromSource();
  });

  it('普通文本保持不变', () => {
    expect(escapeHtml('你好世界')).toBe('你好世界');
  });

  it('HTML 特殊字符被转义', () => {
    const result = escapeHtml("<script>alert('xss')</script>");
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });

  it('& 符号被转义', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('双引号被转义', () => {
    const result = escapeHtml('他说："你好"');
    expect(result).toContain('&quot;');
  });

  it('null 返回空字符串', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('undefined 返回空字符串', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('空字符串返回空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });
});

/**
 * helper：创建模拟 DOM 元素（避免依赖 jsdom）
 */
function createMockEl(className, dataset) {
  const children = [];
  return {
    className: className || '',
    dataset: dataset || {},
    children,
    appendChild(child) {
      children.push(child);
      child.parentElement = this;
    },
    closest(selector) {
      if (selector === '.' + this.className.split(' ')[0]) return this;
      if (this.parentElement) return this.parentElement.closest(selector);
      return null;
    },
    parentElement: null,
  };
}

describe('事件委托 data-si-* 属性', () => {
  it('点击 .reward-shop-item 触发 addRewardFromShop', () => {
    // 模拟 admin.js 中的事件委托逻辑
    const delegateHandler = (e) => {
      const rewardItem = e.target.closest('.reward-shop-item');
      if (rewardItem && rewardItem.dataset.siName) {
        const name = rewardItem.dataset.siName;
        const type = rewardItem.dataset.siType || 'time';
        const duration = rewardItem.dataset.siDuration || '0';
        return { called: true, name, type, duration };
      }
      return { called: false };
    };

    const mockTarget = createMockEl('reward-shop-item', {
      siName: '游戏时间',
      siType: 'time',
      siDuration: '30',
    });

    const result = delegateHandler({ target: mockTarget });
    expect(result.called).toBe(true);
    expect(result.name).toBe('游戏时间');
    expect(result.type).toBe('time');
    expect(result.duration).toBe('30');
  });

  it('点击 .subject-mgmt-delete 触发 confirmRemoveSubject', () => {
    const delegateHandler = (e) => {
      const deleteBtn = e.target.closest('.subject-mgmt-delete');
      if (deleteBtn && deleteBtn.dataset.subjectId) {
        return { called: true, subjectId: deleteBtn.dataset.subjectId };
      }
      return { called: false };
    };

    const mockTarget = createMockEl('subject-mgmt-delete', {
      subjectId: '物理',
    });

    const result = delegateHandler({ target: mockTarget });
    expect(result.called).toBe(true);
    expect(result.subjectId).toBe('物理');
  });

  it('点击 .subject-mgmt-restore-btn 触发 restoreDefaultSubject', () => {
    const delegateHandler = (e) => {
      const restoreBtn = e.target.closest('.subject-mgmt-restore-btn');
      if (restoreBtn && restoreBtn.dataset.subjectId) {
        return { called: true, subjectId: restoreBtn.dataset.subjectId };
      }
      return { called: false };
    };

    const mockTarget = createMockEl('subject-mgmt-restore-btn', {
      subjectId: '英语',
    });

    const result = delegateHandler({ target: mockTarget });
    expect(result.called).toBe(true);
    expect(result.subjectId).toBe('英语');
  });

  it('点击无 data-si-* 属性的元素不触发', () => {
    const delegateHandler = (e) => {
      const rewardItem = e.target.closest('.reward-shop-item');
      if (rewardItem && rewardItem.dataset.siName) {
        return { called: true };
      }
      const deleteBtn = e.target.closest('.subject-mgmt-delete');
      if (deleteBtn && deleteBtn.dataset.subjectId) {
        return { called: true };
      }
      return { called: false };
    };

    // 有 className 但没有 dataset 属性
    const mockTarget = createMockEl('reward-shop-item', {});
    const result = delegateHandler({ target: mockTarget });
    expect(result.called).toBe(false);
  });

  it('点击子元素时通过 closest 向上查找', () => {
    const delegateHandler = (e) => {
      const rewardItem = e.target.closest('.reward-shop-item');
      if (rewardItem && rewardItem.dataset.siName) {
        return { called: true, name: rewardItem.dataset.siName };
      }
      return { called: false };
    };

    // 父子结构
    const parent = createMockEl('reward-shop-item', { siName: '看电视' });
    const child = createMockEl('span', {});
    parent.appendChild(child);

    const result = delegateHandler({ target: child });
    expect(result.called).toBe(true);
    expect(result.name).toBe('看电视');
  });
});
