/**
 * big-screen_xss.test.js - XSS 防护测试
 *
 * Feature: big-screen.js 渲染作业数据时必须转义 HTML 特殊字符
 *   Scenario: confirmStartTask 渲染已驳回作业时 hw.subject 被转义
 *     Given homeworks 包含 hw.subject 为 '<script>alert(1)</script>' 的已驳回作业
 *     When 调用 confirmStartTask
 *     Then innerHTML 不含原始 <script> 标签
 *
 *   Scenario: confirmStartTask 渲染已驳回作业时 hw.content 被转义
 *     Given homeworks 包含 hw.content 为 '<img src=x onerror=alert(1)>' 的已驳回作业
 *     When 调用 confirmStartTask
 *     Then innerHTML 不含原始 <img 标签
 *
 *   Scenario: confirmStartTask 渲染正常作业时 hw.subject 被转义
 *     Given homeworks 包含 hw.subject 为 '<script>alert(1)</script>' 的正常作业
 *     When 调用 confirmStartTask
 *     Then innerHTML 不含原始 <script> 标签
 *
 *   Scenario: confirmStartTask 渲染正常作业时 hw.content 被转义
 *     Given homeworks 包含 hw.content 为 '<img src=x onerror=alert(1)>' 的正常作业
 *     When 调用 confirmStartTask
 *     Then innerHTML 不含原始 <img 标签
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

/**
 * 创建 big-screen.js 的 vm 上下文，用于测试 confirmStartTask
 */
function createBigScreenXssContext(options = {}) {
  const commonCode = fs.readFileSync(
    path.join(__dirname, '..', 'common.js'),
    'utf8'
  );
  const bsCode = fs.readFileSync(
    path.join(__dirname, '..', 'big-screen.js'),
    'utf8'
  );

  // 捕获 innerHTML 赋值
  let capturedInnerHTML = '';

  const mockElement = {
    innerHTML: '',
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {},
    querySelector: () => null,
    textContent: '',
  };

  // 用 Proxy 捕获 innerHTML 赋值
  const contentElement = new Proxy({}, {
    set(target, prop, value) {
      if (prop === 'innerHTML') {
        capturedInnerHTML = value;
      }
      target[prop] = value;
      return true;
    },
    get(target, prop) {
      if (prop === 'innerHTML') return capturedInnerHTML;
      if (prop === 'classList') return { add: () => {}, remove: () => {}, contains: () => false };
      if (prop === 'style') return {};
      return target[prop] || '';
    },
  });

  const context = {
    // common.js 依赖
    document: {
      getElementById: (id) => {
        if (id === 'startConfirmModalContent') return contentElement;
        return mockElement;
      },
      querySelector: () => null,
      createElement: () => {
        let _text = '';
        return {
          get textContent() { return _text; },
          set textContent(v) {
            _text = v;
            // 模拟浏览器行为：textContent 赋值后 innerHTML 返回转义后的 HTML
            this._escaped = String(v)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          },
          get innerHTML() { return this._escaped || ''; },
        };
      },
    },
    window: {
      addEventListener: () => {},
    },
    navigator: { serviceWorker: { register: async () => ({ scope: '' }) } },
    // big-screen.js 依赖
    cachedData: options.cachedData || {
      settings: { subjects: [{ id: '语文', icon: '📖', color: '#f87171' }] },
    },
    homeworks: options.homeworks || [],
    // big-screen.js 中用到的全局函数
    isTomorrowHoliday: () => false,
    closeStartConfirm: () => {},
    startHomework: () => {},
    requestDeferHomework: () => {},
    completeInSchool: () => {},
    // 通用依赖
    console, JSON, Error, Object, Array, Math, Date, Map, Set, Promise,
    String, Number, Boolean, RegExp, parseInt, parseFloat,
    isNaN, isFinite, setTimeout, clearTimeout,
    Util: { formatDuration: (s) => s + '秒', formatDate: (d) => '01-01' },
  };

  vm.createContext(context);
  // 先加载 common.js（提供 escapeHtml、DEFAULT_SUBJECTS 等）
  vm.runInContext(commonCode + '\n' + bsCode, context);

  return { context, getCapturedHTML: () => capturedInnerHTML };
}

describe('confirmStartTask XSS 防护', () => {
  it('已驳回作业: hw.subject 中的 <script> 被转义', () => {
    const { context, getCapturedHTML } = createBigScreenXssContext({
      homeworks: [{
        id: 'hw1',
        subject: '<script>alert(1)</script>',
        content: '正常内容',
        rejected: true,
        mode: 'challenge',
        suggestedDuration: 30,
      }],
    });

    context.confirmStartTask('hw1');
    const html = getCapturedHTML();

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('已驳回作业: hw.content 中的 <img onerror> 被转义', () => {
    const { context, getCapturedHTML } = createBigScreenXssContext({
      homeworks: [{
        id: 'hw1',
        subject: '语文',
        content: '<img src=x onerror=alert(1)>',
        rejected: true,
        mode: 'challenge',
        suggestedDuration: 30,
      }],
    });

    context.confirmStartTask('hw1');
    const html = getCapturedHTML();

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('正常作业: hw.subject 中的 <script> 被转义', () => {
    const { context, getCapturedHTML } = createBigScreenXssContext({
      homeworks: [{
        id: 'hw2',
        subject: '<script>alert(1)</script>',
        content: '正常内容',
        rejected: false,
        mode: 'challenge',
        suggestedDuration: 30,
      }],
    });

    context.confirmStartTask('hw2');
    const html = getCapturedHTML();

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('正常作业: hw.content 中的 <img onerror> 被转义', () => {
    const { context, getCapturedHTML } = createBigScreenXssContext({
      homeworks: [{
        id: 'hw2',
        subject: '语文',
        content: '<img src=x onerror=alert(1)>',
        rejected: false,
        mode: 'challenge',
        suggestedDuration: 30,
      }],
    });

    context.confirmStartTask('hw2');
    const html = getCapturedHTML();

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
