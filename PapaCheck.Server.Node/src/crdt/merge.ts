import type { CRDTOperation, PNCounterState, ORSetState } from './types.js';

/**
 * 字段级 LWW（Last-Writer-Wins）合并
 * 比较 timestamp，值越大越新；相同时比较 nodeId 字典序，较大者赢
 */
export function mergeFieldLWW(
  currentValue: any,
  incomingValue: any,
  currentTime: string,
  incomingTime: string,
  currentNodeId: string,
  incomingNodeId: string
): any {
  if (currentTime > incomingTime) return currentValue;
  if (currentTime < incomingTime) return incomingValue;
  // timestamp 相同，比较 nodeId 字典序
  return currentNodeId > incomingNodeId ? currentValue : incomingValue;
}

/**
 * PN-Counter 合并
 * earn 和 spend 分别取最大值
 */
export function mergePNCounter(
  current: PNCounterState,
  incoming: PNCounterState
): PNCounterState {
  return {
    earn: Math.max(current.earn, incoming.earn),
    spend: Math.max(current.spend, incoming.spend),
  };
}

/**
 * OR-Set 合并
 * additions 和 removals 分别取并集（去重）
 */
export function mergeORSet<T>(
  current: ORSetState<T>,
  incoming: ORSetState<T>
): ORSetState<T> {
  const additions = [...new Set([...current.additions, ...incoming.additions])];
  const removals = [...new Set([...current.removals, ...incoming.removals])];
  return { additions, removals };
}

/**
 * 主入口：根据 table + field 分发到对应合并函数
 * 对当前状态应用一个 CRDT 操作
 */
export function applyOperation(
  currentState: any,
  op: CRDTOperation
): any {
  // 目前仅支持字段级 LWW 更新
  // 未来可扩展：根据 table 分发到 PN-Counter、OR-Set 等
  if (op.type === 'update' && op.field !== null) {
    const field = op.field;
    const currentValue = currentState[field];
    const incomingValue = op.value;
    // 对于对象类型的值（如 PNCounterState、ORSetState），使用对应的合并函数
    if (isPNCounterState(currentValue) && isPNCounterState(incomingValue)) {
      return {
        ...currentState,
        [field]: mergePNCounter(currentValue, incomingValue),
      };
    }
    if (isORSetState(currentValue) && isORSetState(incomingValue)) {
      return {
        ...currentState,
        [field]: mergeORSet(currentValue, incomingValue),
      };
    }
    // 默认标量字段使用 LWW
    const newValue = mergeFieldLWW(
      currentValue,
      incomingValue,
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

function isPNCounterState(value: any): value is PNCounterState {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.earn === 'number' &&
    typeof value.spend === 'number'
  );
}

function isORSetState(value: any): value is ORSetState<any> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray(value.additions) &&
    Array.isArray(value.removals)
  );
}
