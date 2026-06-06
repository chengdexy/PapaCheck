// Feature: CRDT 合并引擎
//   Scenario: 字段级 LWW 合并
//     Given 两个冲突的字段值
//     When 比较它们的 timestamp 和 nodeId
//     Then 较新的 timestamp 胜出，相同时戳下 nodeId 较大者胜出

import { describe, it, expect } from 'vitest';
import { mergeFieldLWW, mergePNCounter, mergeORSet, applyOperation } from '../src/crdt/merge.js';
import type { CRDTOperation } from '../src/crdt/types.js';

describe('mergeFieldLWW', () => {
  it('较新的时间戳胜出', () => {
    const result = mergeFieldLWW('pending', 'completed', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'node-a', 'node-b');
    expect(result).toBe('completed');
  });

  it('相同时戳下 nodeId 较大者胜出', () => {
    const result = mergeFieldLWW('pending', 'completed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'a', 'b');
    expect(result).toBe('completed'); // 'b' > 'a'
  });

  it('当前值较新时保留当前值', () => {
    const result = mergeFieldLWW('completed', 'pending', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z', 'node-a', 'node-b');
    expect(result).toBe('completed');
  });
});

describe('mergePNCounter', () => {
  it('合并后 earn 取最大值', () => {
    const result = mergePNCounter({ earn: 10, spend: 5 }, { earn: 15, spend: 3 });
    expect(result.earn).toBe(15);
    expect(result.spend).toBe(5); // 取最大值
  });

  it('余额 = earn - spend', () => {
    // 不直接测试余额，测试 earn/spend 值的正确性
    const result = mergePNCounter({ earn: 20, spend: 8 }, { earn: 15, spend: 10 });
    expect(result.earn).toBe(20);
    expect(result.spend).toBe(10);
  });
});

describe('mergeORSet', () => {
  it('合并后 additions 取并集', () => {
    const result = mergeORSet(
      { additions: ['a', 'b'], removals: ['c'] },
      { additions: ['b', 'c'], removals: ['a'] }
    );
    expect(result.additions).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(result.removals).toEqual(expect.arrayContaining(['a', 'c']));
  });
});

describe('applyOperation', () => {
  it('字段级更新只修改指定字段', () => {
    const state = { id: 'hw-1', status: 'pending', rating: null, subject: '数学' };
    const op: CRDTOperation = {
      id: 'op-1', type: 'update', table: 'homeworks',
      resourceId: 'hw-1', field: 'status', value: 'completed',
      timestamp: '2026-01-02T00:00:00Z', nodeId: 'node-b',
    };
    const result = applyOperation(state, op);
    expect(result.status).toBe('completed');
    expect(result.rating).toBeNull(); // 未修改
    expect(result.subject).toBe('数学'); // 未修改
  });
});
