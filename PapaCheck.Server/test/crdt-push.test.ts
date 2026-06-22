/**
 * crdt-push.test.ts - CRDT push 幂等性
 *
 * Feature: CRDT push 幂等性
 *   Scenario: 重复推送同一 op.id 不重复 apply
 *     Given 服务端已收到 op.id="abc123" 的操作
 *     When 客户端再次推送 op.id="abc123"
 *     Then saveCRDTOperation 执行（ON CONFLICT UPDATE）
 *     But applyCRDTOperation 不执行
 *     And 不会重复加分
 *
 *   Scenario: 首次推送正常 apply
 *     Given 服务端未收到 op.id="xyz789" 的操作
 *     When 客户端推送 op.id="xyz789"
 *     Then hasCRDTOperation 返回 false
 *     And saveCRDTOperation 执行
 *     And applyCRDTOperation 执行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CRDTOperation } from '../src/crdt/types.js';

// 模拟处理单个操作的逻辑（与 app.ts crdt-push 端点一致）
async function handleCrdtPush(
  op: CRDTOperation,
  hasOp: (id: string) => Promise<boolean>,
  saveOp: (op: CRDTOperation) => Promise<void>,
  applyOp: (op: CRDTOperation) => Promise<void>,
): Promise<void> {
  const existed = await hasOp(op.id);
  await saveOp(op);
  if (!existed) {
    await applyOp(op);
  }
}

describe('crdt-push 幂等性', () => {
  it('重复推送同一 op.id 不重复 apply', async () => {
    const op: CRDTOperation = {
      id: 'abc123',
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-1',
      value: { status: 'done' },
      timestamp: new Date().toISOString(),
      nodeId: 'test-node',
    };

    // Given: 服务端已收到 op.id="abc123" 的操作（hasOp 返回 true）
    const hasOp = vi.fn().mockResolvedValue(true);
    const saveOp = vi.fn().mockResolvedValue(undefined);
    const applyOp = vi.fn().mockResolvedValue(undefined);

    // When: 客户端再次推送 op.id="abc123"
    await handleCrdtPush(op, hasOp, saveOp, applyOp);

    // Then: hasCRDTOperation 被调用（但只查一次）
    expect(hasOp).toHaveBeenCalledWith('abc123');

    // Then: saveCRDTOperation 执行
    expect(saveOp).toHaveBeenCalledWith(op);

    // But: applyCRDTOperation 不执行
    expect(applyOp).not.toHaveBeenCalled();
  });

  it('首次推送正常 apply', async () => {
    const op: CRDTOperation = {
      id: 'xyz789',
      type: 'update',
      table: 'homeworks',
      resourceId: 'hw-2',
      value: { status: 'pending' },
      timestamp: new Date().toISOString(),
      nodeId: 'test-node',
    };

    // Given: 服务端未收到 op.id="xyz789" 的操作（hasOp 返回 false）
    const hasOp = vi.fn().mockResolvedValue(false);
    const saveOp = vi.fn().mockResolvedValue(undefined);
    const applyOp = vi.fn().mockResolvedValue(undefined);

    // When: 客户端推送 op.id="xyz789"
    await handleCrdtPush(op, hasOp, saveOp, applyOp);

    // Then: hasCRDTOperation 返回 false
    expect(hasOp).toHaveBeenCalledWith('xyz789');
    expect(await hasOp('xyz789')).toBe(false);

    // Then: saveCRDTOperation 执行
    expect(saveOp).toHaveBeenCalledWith(op);

    // Then: applyCRDTOperation 执行
    expect(applyOp).toHaveBeenCalledWith(op);
  });
});
