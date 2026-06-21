/**
 * child-switcher.test.js - 家长端孩子切换测试（已废弃）
 *
 * 孩子切换功能已从 admin.js 中移除，替换为"切换孩子"按钮（跳转登录页重新选择）。
 * 此测试文件保留骨架作为功能移除记录。
 */

import { describe, it, expect } from 'vitest';

// ==================== Mock render functions ====================

/**
 * 模拟 _renderChildSelector 逻辑（已废弃）
 */
function renderChildSelector(children, currentChildId, activeTab) {
  // 共享标签不需要孩子选择器
  if (activeTab === 'shop' || activeTab === 'settings') {
    return { visible: false, children: [] };
  }

  if (!children || children.length === 0) {
    return { visible: true, empty: true };
  }

  return {
    visible: true,
    empty: false,
    children: children.map(c => ({
      child_id: c.child_id,
      nickname: c.nickname,
      active: c.child_id === currentChildId,
    })),
  };
}

/**
 * 模拟 loadChildren 逻辑（已废弃）
 */
function loadChildren(members, lastChildId) {
  const children = (members || [])
    .filter(m => m.role === 'child' && m.child_id)
    .map(m => ({ child_id: m.child_id, nickname: m.nickname }));

  let currentChildId = null;
  if (children.length > 0) {
    if (lastChildId && children.find(c => c.child_id === lastChildId)) {
      currentChildId = lastChildId;
    } else {
      currentChildId = children[0].child_id;
    }
  }

  return { children, currentChildId };
}

describe.skip('Child Switcher (家长端孩子切换 · 功能已移除)', () => {
  // Scenario: 有孩子时显示选择栏，默认选中第一个
  it('有孩子时显示选择栏，默认选中第一个', () => {
    const members = [
      { id: 'ac1', role: 'child', nickname: '小明', child_id: 'child_1' },
      { id: 'ac2', role: 'child', nickname: '小红', child_id: 'child_2' },
      { id: 'ac3', role: 'parent', nickname: '爸爸', child_id: null },
    ];

    const { children, currentChildId } = loadChildren(members, null);

    // 应该有 2 个孩子
    expect(children.length).toBe(2);
    expect(children[0].nickname).toBe('小明');
    expect(children[1].nickname).toBe('小红');

    // 默认选中第一个
    expect(currentChildId).toBe('child_1');

    // 渲染选择栏
    const rendered = renderChildSelector(children, currentChildId, 'homework');
    expect(rendered.visible).toBe(true);
    expect(rendered.empty).toBe(false);
    expect(rendered.children.length).toBe(2);
    expect(rendered.children[0].active).toBe(true);   // 小明选中
    expect(rendered.children[1].active).toBe(false);   // 小红未选中
  });

  // Scenario: 切换孩子时更新 currentChildId
  it('切换孩子时更新 currentChildId', () => {
    const members = [
      { id: 'ac1', role: 'child', nickname: '小明', child_id: 'child_1' },
      { id: 'ac2', role: 'child', nickname: '小红', child_id: 'child_2' },
    ];

    const { children, currentChildId } = loadChildren(members, null);
    expect(currentChildId).toBe('child_1');

    // 模拟切换到小红
    const newChildId = 'child_2';
    const rendered = renderChildSelector(children, newChildId, 'homework');
    expect(rendered.children[0].active).toBe(false);  // 小明未选中
    expect(rendered.children[1].active).toBe(true);   // 小红选中
  });

  // Scenario: 无孩子时显示提示
  it('无孩子时显示提示', () => {
    // 只有家长，没有孩子
    const members = [
      { id: 'ac1', role: 'parent', nickname: '爸爸', child_id: null },
    ];

    const { children, currentChildId } = loadChildren(members, null);
    expect(children.length).toBe(0);
    expect(currentChildId).toBeNull();

    const rendered = renderChildSelector(children, currentChildId, 'homework');
    expect(rendered.visible).toBe(true);
    expect(rendered.empty).toBe(true);
  });

  // Scenario: 孩子没有 child_id 时不被列入
  it('child_id 为 null 的成员不计入孩子列表', () => {
    const members = [
      { id: 'ac1', role: 'child', nickname: '孤儿', child_id: null },
      { id: 'ac2', role: 'child', nickname: '小明', child_id: 'child_1' },
    ];

    const { children } = loadChildren(members, null);
    expect(children.length).toBe(1);
    expect(children[0].nickname).toBe('小明');
  });

  // Scenario: 商店标签隐藏孩子选择栏
  it('商店标签时隐藏孩子选择栏', () => {
    const children = [
      { child_id: 'child_1', nickname: '小明' },
    ];

    const rendered = renderChildSelector(children, 'child_1', 'shop');
    expect(rendered.visible).toBe(false);
  });

  // Scenario: 设置标签隐藏孩子选择栏
  it('设置标签时隐藏孩子选择栏', () => {
    const children = [
      { child_id: 'child_1', nickname: '小明' },
    ];

    const rendered = renderChildSelector(children, 'child_1', 'settings');
    expect(rendered.visible).toBe(false);
  });

  // Scenario: localStorage 恢复上次选中
  it('从 localStorage 恢复上次选中的孩子', () => {
    const members = [
      { id: 'ac1', role: 'child', nickname: '小明', child_id: 'child_1' },
      { id: 'ac2', role: 'child', nickname: '小红', child_id: 'child_2' },
    ];

    // 上次选中的是小红
    const { currentChildId } = loadChildren(members, 'child_2');
    expect(currentChildId).toBe('child_2');
  });

  // Scenario: localStorage 中不存在的孩子时回退到第一个
  it('localStorage 中不存在的孩子时回退到第一个', () => {
    const members = [
      { id: 'ac1', role: 'child', nickname: '小明', child_id: 'child_1' },
    ];

    const { currentChildId } = loadChildren(members, 'non_existent_child');
    expect(currentChildId).toBe('child_1');
  });

  // Scenario: API.getData 传递 child_id 参数
  it('API.getData 传递 child_id 参数', () => {
    // 模拟 api.js getData 逻辑
    function getData(childId) {
      var query = childId ? '?child_id=' + encodeURIComponent(childId) : '';
      return '/api/data' + query;
    }

    expect(getData('child_1')).toBe('/api/data?child_id=child_1');
    expect(getData(null)).toBe('/api/data');
    expect(getData(undefined)).toBe('/api/data');
    expect(getData('')).toBe('/api/data');
  });
});
