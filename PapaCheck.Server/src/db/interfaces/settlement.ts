export interface ISettlementStore {
  getSettlement(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  saveSettlement(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  putSettlement(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  patchSettlement(dateKey: string, fields: any, tenantId?: string, childId?: string): Promise<void>;
  getEfficiency(dateKey: string, tenantId?: string, childId?: string): Promise<any>;
  saveEfficiency(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  putEfficiency(dateKey: string, data: any, tenantId?: string, childId?: string): Promise<void>;
  resetDate(dateKey: string, tenantId?: string, childId?: string): Promise<void>;
}
