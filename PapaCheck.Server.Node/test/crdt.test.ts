// Feature: CRDT 合并引擎
//   Scenario: 字段级 LWW 合并
//     Given 两个冲突的字段值
//     When 比较它们的 timestamp 和 nodeId
//     Then 较新的 timestamp 胜出，相同时戳下 nodeId 较大者胜出

import { describe, it, expect } from 'vitest';
import { mergeFieldLWW, applyOperation } from '../src/crdt/merge.js';
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
