import type {
  ShopItemDTO, RedemptionDTO, RewardBoxItemDTO,
  BuffDTO, BountyTaskDTO, BountySubmissionDTO, BountyCompletionDTO,
} from '../dto.js';

export interface IShopStore {
  getPointsBalance(tenantId?: string, childId?: string): Promise<number>;
  updatePoints(action: 'earn' | 'spend', amount: number, detail: string, tenantId?: string, childId?: string): Promise<number>;
  patchPoints(delta: { earn?: number; spend?: number; detail?: string }, tenantId?: string, childId?: string): Promise<number>;
  getShopItems(tenantId?: string): Promise<ShopItemDTO[]>;
  saveShopItems(items: ShopItemDTO[], tenantId?: string): Promise<void>;
  getShopItemById(id: string, tenantId?: string): Promise<ShopItemDTO | null>;
  putShopItem(id: string, data: ShopItemDTO, tenantId?: string): Promise<void>;
  deleteShopItem(id: string, tenantId?: string): Promise<void>;
  getRedemptions(tenantId?: string, childId?: string): Promise<RedemptionDTO[]>;
  saveRedemptions(items: RedemptionDTO[], tenantId?: string, childId?: string): Promise<void>;
  clearFulfilledRedemptions(tenantId?: string, childId?: string): Promise<void>;
  putRedemption(id: string, data: RedemptionDTO, tenantId?: string, childId?: string): Promise<void>;
  getRewardBox(tenantId?: string, childId?: string): Promise<RewardBoxItemDTO[]>;
  saveRewardBox(items: RewardBoxItemDTO[], tenantId?: string, childId?: string): Promise<void>;
  putRewardBoxItem(id: string, data: RewardBoxItemDTO, tenantId?: string, childId?: string): Promise<void>;
  deleteRewardBoxItem(id: string, tenantId?: string, childId?: string): Promise<void>;
  getActiveBuffs(tenantId?: string, childId?: string): Promise<BuffDTO[]>;
  saveActiveBuffs(items: BuffDTO[], tenantId?: string, childId?: string): Promise<void>;
  putBuff(id: string, data: BuffDTO, tenantId?: string, childId?: string): Promise<void>;
  deleteBuff(id: string, tenantId?: string, childId?: string): Promise<void>;
  getBountyTasks(tenantId?: string): Promise<BountyTaskDTO[]>;
  saveBountyTasks(items: BountyTaskDTO[], tenantId?: string): Promise<void>;
  getBountyTaskById(id: string, tenantId?: string): Promise<BountyTaskDTO | null>;
  putBountyTask(id: string, data: BountyTaskDTO, tenantId?: string): Promise<void>;
  deleteBountyTask(id: string, tenantId?: string): Promise<void>;
  getBountySubmissions(dateKey: string, tenantId?: string, childId?: string): Promise<BountySubmissionDTO[]>;
  saveBountySubmissions(dateKey: string, data: BountySubmissionDTO[], tenantId?: string, childId?: string): Promise<void>;
  putBountySubmission(id: string, data: BountySubmissionDTO, tenantId?: string, childId?: string): Promise<void>;
  getBountyCompletions(dateKey: string, tenantId?: string, childId?: string): Promise<BountyCompletionDTO | null>;
  saveBountyCompletions(dateKey: string, data: BountyCompletionDTO, tenantId?: string, childId?: string): Promise<void>;
  putBountyCompletion(id: string, data: BountyCompletionDTO, tenantId?: string, childId?: string): Promise<void>;
}
