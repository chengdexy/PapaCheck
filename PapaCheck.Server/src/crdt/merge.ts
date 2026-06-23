import type { CRDTOperation } from './types.js';

/**
 * 字段级 LWW（Last-Writer-Wins）合并
 * 比较 timestamp，值越大越新；相同时比较 nodeId 字典序，较大者赢
 */
export function mergeFieldLWW<T>(
  currentValue: T,
  incomingValue: T,
  currentTime: string,
  incomingTime: string,
  currentNodeId: string,
  incomingNodeId: string
): T {
  if (currentTime > incomingTime) return currentValue;
  if (currentTime < incomingTime) return incomingValue;
  // timestamp 相同，比较 nodeId 字典序
  return currentNodeId > incomingNodeId ? currentValue : incomingValue;
}

/**
 * 主入口：根据 table + field 分发到对应合并函数
 * 对当前状态应用一个 CRDT 操作
 */
export function applyOperation(
  currentState: any,
  op: CRDTOperation
): any {
  // 目前仅支持字段级 LWW 更新（简化后删除 PN-Counter/OR-Set 分支）
  if (op.type === 'update' && op.field !== null) {
    const field = op.field;
    const currentValue = currentState[field];
    const incomingValue = op.value;
    const newValue = mergeFieldLWW(
      currentValue,
      incomingValue as typeof currentValue,
      currentState._timestamp || '1970-01-01T00:00:00Z',
      op.timestamp,
      currentState._nodeId || '',
      op.nodeId
    );
    return {
      ...currentState,
      [field]: newValue,
    };
  }

  // add / delete 操作或 field 为 null 的全量操作暂不处理，直接返回
  return currentState;
}
