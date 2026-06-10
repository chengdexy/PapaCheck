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
let calcLOESS;

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
  calcLOESS = context.calcLOESS;
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

describe('renderSvgLineChart', () => {
  // Simplified renderSvgLineChart that uses calcMedian and calcLOESS from vm context
  function renderSvgLineChart(data, options = {}) {
    const {
      width = 600, height = 180, color = 'var(--success)',
      avgColor = 'var(--accent)', unit = '', yMax,
      showLOESS = false, loessColor = '#a78bfa',
    } = options;
    const pad = { top: 20, right: 20, bottom: 25, left: 40 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const values = data.map(d => d.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const maxVal = yMax || rawMax;
    const minVal = rawMin > 0 ? Math.max(0, Math.floor(rawMin * 0.9 / 10) * 10) : 0;
    const range = maxVal - minVal || 1;
    const medianVal = calcMedian(values);

    const points = data.map((d, i) => {
      const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
      const y = pad.top + chartH - ((d.value - minVal) / range) * chartH;
      return { x, y, label: d.label, value: d.value };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const circles = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${color}" stroke="var(--card)" stroke-width="1.5"/>`).join('');
    const maxLabels = Math.min(points.length, 10);
    const labelStep = points.length > 1 ? (points.length - 1) / Math.max(maxLabels - 1, 1) : 1;
    const labelIndices = [];
    for (let k = 0; k < maxLabels; k++) labelIndices.push(Math.min(Math.round(k * labelStep), points.length - 1));
    const labels = labelIndices.map(i => `<text x="${points[i].x}" y="${height - 5}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${points[i].label}</text>`).join('');
    const dataMax = Math.max(...values);
    const dataMin = Math.min(...values);
    const valuesTxt = points.filter(p => p.value === dataMax || p.value === dataMin).map(p => `<text class="chart-value-label" x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" fill="${color}">${p.value}</text>`).join('');
    const yLabels = [];
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const val = Math.round(minVal + (range / ySteps) * (ySteps - i));
      const yy = pad.top + (chartH / ySteps) * i;
      yLabels.push(`<text x="${pad.left - 6}" y="${yy + 3}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${val}</text>`);
      if (i > 0) yLabels.push(`<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`);
    }

    // 中值线
    const medianY = pad.top + chartH - ((medianVal - minVal) / range) * chartH;
    let medianLine = '';
    if (medianVal > 0 && values.length > 1) {
      medianLine = `<line x1="${pad.left}" y1="${medianY}" x2="${width - pad.right}" y2="${medianY}" stroke="${avgColor}" stroke-dasharray="4,4" stroke-width="1.5"/>
        <text x="${width - pad.right}" y="${medianY - 4}" text-anchor="end" font-size="10" fill="${avgColor}">中值 ${Math.round(medianVal)}${unit}</text>`;
    }

    // LOESS 曲线
    let loessSvg = '';
    if (showLOESS && data.length >= 4) {
      const loessData = calcLOESS(data, 0.5);
      if (loessData) {
        const loessPoints = loessData.map((pt, i) => {
          const x = pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
          const y = pad.top + chartH - ((pt.y - minVal) / range) * chartH;
          return { x, y };
        });
        const loessPath = loessPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        loessSvg = `<path d="${loessPath}" fill="none" stroke="${loessColor}" stroke-width="1.5" stroke-linejoin="round"/>`;
      }
    }

    return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;">
      ${yLabels.join('')}
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      ${circles}
      ${medianLine}
      ${loessSvg}
      ${valuesTxt}
      ${labels}
    </svg>`;
  }

  it('should render "中值" instead of "平均" in median line label', () => {
    const data = [{ label: '1', value: 10 }, { label: '2', value: 20 }, { label: '3', value: 30 }];
    const svg = renderSvgLineChart(data, { unit: '分钟' });
    expect(svg).toContain('中值');
    expect(svg).not.toContain('平均');
  });

  it('should render LOESS path when showLOESS is true and data >= 4 points', () => {
    const data = [
      { label: '1', value: 10 }, { label: '2', value: 15 },
      { label: '3', value: 13 }, { label: '4', value: 20 }, { label: '5', value: 18 },
    ];
    const svg = renderSvgLineChart(data, { showLOESS: true });
    const pathMatches = svg.match(/<path /g);
    expect(pathMatches).not.toBeNull();
    expect(pathMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('should not render LOESS path when showLOESS is false', () => {
    const data = [
      { label: '1', value: 10 }, { label: '2', value: 15 },
      { label: '3', value: 13 }, { label: '4', value: 20 },
    ];
    const svg = renderSvgLineChart(data, { showLOESS: false });
    const pathMatches = svg.match(/<path /g);
    expect(pathMatches).toHaveLength(1);
  });

  it('should not render LOESS path when data has < 4 points even if showLOESS is true', () => {
    const data = [{ label: '1', value: 10 }, { label: '2', value: 20 }, { label: '3', value: 30 }];
    const svg = renderSvgLineChart(data, { showLOESS: true });
    const pathMatches = svg.match(/<path /g);
    expect(pathMatches).toHaveLength(1);
  });
});
