/**
 * chart-helpers.test.js - calcMedian 纯函数测试
 * 测试 admin.js 中的 calcMedian 实现，避免重复定义
 *
 * Feature: calcMedian 中值计算
 *   Scenario: 奇数长度数组返回中间值
 *     Given 数组 [1, 5, 3]
 *     When 调用 calcMedian
 *     Then 返回排序后的中间值 3
 *
 *   Scenario: 偶数长度数组返回中间两数的平均值
 *     Given 数组 [1, 5, 3, 7]
 *     When 调用 calcMedian
 *     Then 返回中间两数平均值 4
 *
 *   Scenario: 未排序数组也能正确计算
 *     Given 未排序数组 [10, 1, 8, 3, 6]
 *     When 调用 calcMedian
 *     Then 返回排序后的中间值 6
 *
 *   Scenario: 单个元素返回该元素
 *     Given 数组 [42]
 *     When 调用 calcMedian
 *     Then 返回 42
 *
 *   Scenario: 两个元素返回平均值
 *     Given 数组 [10, 20]
 *     When 调用 calcMedian
 *     Then 返回 15
 *
 *   Scenario: 空数组返回 0
 *     Given 空数组 []
 *     When 调用 calcMedian
 *     Then 返回 0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

function createMockDoc() {
  const elements = {};
  return {
    getElementById: (id) => elements[id] || null,
    _setElement: (id, el) => { elements[id] = el; },
    createElement: () => ({
      textContent: '', innerHTML: '',
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      addEventListener: () => {}, style: {}, appendChild: () => {}, dataset: {},
    }),
    querySelectorAll: () => ({ forEach: (fn) => {} }),
    querySelector: () => null,
  };
}

let calcMedian;

beforeAll(() => {
  const adminCode = fs.readFileSync(
    path.join(__dirname, '..', 'admin.js'),
    'utf8'
  );

  const doc = createMockDoc();
  doc._setElement('transitionMask', { style: { display: 'none' } });
  doc._setElement('transitionText', { textContent: '' });
  doc._setElement('adminDate', { textContent: '' });
  doc._setElement('adminModal', { classList: { add: () => {}, remove: () => {} }, addEventListener: () => {} });
  doc._setElement('toast', { textContent: '', classList: { add: () => {}, remove: () => {} } });
  doc._setElement('adminContent', { innerHTML: '' });

  const context = vm.createContext({
    document: doc,
    navigator: { serviceWorker: { register: async () => ({ scope: '' }) } },
    window: { addEventListener: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    location: { href: '' },
    localStorage: { getItem: () => null, setItem: () => {} },
    ConnectionManager: { getMode: () => 'online', start: async () => {} },
    API: { getData: async () => ({}), migrateBountyCompletionsToTotal: () => {} },
    DB: { cacheFullData: async () => {}, getFullData: async () => ({}) },
    CRDTLog: { append: () => {}, migrateFromChangeLog: async () => {} },
    cachedData: null, adminHomeworks: [], adminBountyTasks: [],
    console, setTimeout, clearTimeout, setInterval: () => ({}),
    JSON, Error, Object, Array, Math, Date, Map, Set, Promise,
    String, Number, Boolean, RegExp, parseInt, parseFloat,
    isNaN, isFinite, Symbol, WeakMap, WeakSet,
  });

  vm.runInContext(adminCode, context, { timeout: 5000 });
  calcMedian = context.calcMedian;
});

describe('calcMedian', () => {
  it('should return middle value for odd-length array', () => {
    expect(calcMedian([1, 5, 3])).toBe(3);
  });

  it('should return average of two middle values for even-length array', () => {
    expect(calcMedian([1, 5, 3, 7])).toBe(4);
  });

  it('should work with unsorted input', () => {
    expect(calcMedian([10, 1, 8, 3, 6])).toBe(6);
  });

  it('should handle single element', () => {
    expect(calcMedian([42])).toBe(42);
  });

  it('should handle two elements', () => {
    expect(calcMedian([10, 20])).toBe(15);
  });

  it('should return 0 for empty array', () => {
    expect(calcMedian([])).toBe(0);
  });
});

describe('calcLOESS', () => {
  function calcLOESS(data, span = 0.5) {
    const n = data.length;
    if (n < 4) return null;
    const values = data.map(d => d.value);
    const xVals = data.map((_, i) => i);

    const result = [];
    for (let i = 0; i < n; i++) {
      const x0 = i;
      const distances = xVals.map(x => Math.abs(x - x0));
      const sortedDists = [...distances].sort((a, b) => a - b);
      const maxDist = sortedDists[Math.min(Math.floor(span * n), n - 1)] || 1;

      const weights = distances.map(d => {
        const u = d / maxDist;
        return u <= 1 ? Math.pow(1 - Math.pow(u, 3), 3) : 0;
      });

      const sumW = weights.reduce((s, w) => s + w, 0);
      if (sumW === 0) {
        result.push({ x: i, y: values[i] });
        continue;
      }

      const sumWX = weights.reduce((s, w, j) => s + w * xVals[j], 0);
      const sumWY = weights.reduce((s, w, j) => s + w * values[j], 0);
      const sumWX2 = weights.reduce((s, w, j) => s + w * xVals[j] * xVals[j], 0);
      const sumWXY = weights.reduce((s, w, j) => s + w * xVals[j] * values[j], 0);

      const denom = sumW * sumWX2 - sumWX * sumWX;
      if (Math.abs(denom) < 1e-10) {
        result.push({ x: i, y: sumWY / sumW });
        continue;
      }

      const slope = (sumW * sumWXY - sumWX * sumWY) / denom;
      const intercept = (sumWY - slope * sumWX) / sumW;
      result.push({ x: i, y: slope * x0 + intercept });
    }
    return result;
  }

  it('should return null for fewer than 4 points', () => {
    expect(calcLOESS([{ value: 1 }, { value: 2 }, { value: 3 }])).toBeNull();
  });

  it('should return array of same length as input for >=4 points', () => {
    const data = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }];
    const result = calcLOESS(data);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(5);
  });

  it('should produce smoothed values close to original for linear data', () => {
    const data = [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }, { value: 50 }];
    const result = calcLOESS(data);
    expect(result).not.toBeNull();
    result.forEach((pt, i) => {
      expect(Math.abs(pt.y - data[i].value)).toBeLessThan(5);
    });
  });

  it('should return objects with x and y properties', () => {
    const data = [{ value: 1 }, { value: 5 }, { value: 3 }, { value: 8 }, { value: 2 }];
    const result = calcLOESS(data);
    expect(result).not.toBeNull();
    expect(result[0]).toHaveProperty('x');
    expect(result[0]).toHaveProperty('y');
  });
});
