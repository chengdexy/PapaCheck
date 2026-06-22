export type CRDTOperationType = 'add' | 'update' | 'delete';

export interface CRDTOperation {
  id: string;           // 全局唯一 ID（uuid）
  type: CRDTOperationType;
  table: string;        // homeworks, points, shop_items...
  resourceId: string;   // 资源 ID
  field: string | null; // 更新的字段名，null 表示全量
  value: any;           // 新值
  timestamp: string;    // ISO 时间戳
  nodeId: string;       // 节点标识（区分客户端）
}
