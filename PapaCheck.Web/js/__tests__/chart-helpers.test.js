/**
 * chart-helpers.test.js - calcMedian 纯函数测试
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

function calcMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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
