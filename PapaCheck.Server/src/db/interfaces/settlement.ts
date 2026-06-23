import type { SettlementDTO, EfficiencyDTO } from '../dto.js';

export interface ISettlementStore {
  getSettlement(dateKey: string, tenantId?: string, childId?: string): Promise<SettlementDTO | null>;
  saveSettlement(dateKey: string, data: SettlementDTO, tenantId?: string, childId?: string): Promise<void>;
  putSettlement(dateKey: string, data: SettlementDTO, tenantId?: string, childId?: string): Promise<void>;
  patchSettlement(dateKey: string, fields: Partial<SettlementDTO>, tenantId?: string, childId?: string): Promise<void>;
  getEfficiency(dateKey: string, tenantId?: string, childId?: string): Promise<EfficiencyDTO | null>;
  saveEfficiency(dateKey: string, data: EfficiencyDTO, tenantId?: string, childId?: string): Promise<void>;
  putEfficiency(dateKey: string, data: EfficiencyDTO, tenantId?: string, childId?: string): Promise<void>;
  resetDate(dateKey: string, tenantId?: string, childId?: string): Promise<void>;
}
