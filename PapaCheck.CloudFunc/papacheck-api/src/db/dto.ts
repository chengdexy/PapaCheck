// PapaCheck.Server/src/db/dto.ts

// ==================== Core Business DTOs ====================

export interface HomeworkDTO {
  id: string;
  subject: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'paused';
  suggestedDuration: number;
  actualDuration: number | null;
  rating: 'excellent' | 'good' | 'fair' | 'poor' | null;
  submittedAt?: string;
  hasRating?: boolean;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface SettlementDTO {
  dailyBase: number;
  rating: string | null;
  ratingMultiplier: number;
  efficiencyRatio?: number;
  viewedAt?: string;
  submittedAt?: string;
  lastModified?: string;
  [key: string]: unknown;
}

export interface EfficiencyDTO {
  efficiencyRatio?: number;
  averageRatio?: number;
  lastModified?: string;
  [key: string]: unknown;
}

export interface ShopItemDTO {
  id: string;
  name: string;
  cost: number;
  baseQuantity: number;
  remainingQuantity?: number;
  dailyLimit?: number;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface RedemptionDTO {
  id: string;
  itemId: string;
  status: 'pending' | 'fulfilled' | 'cancelled';
  cost: number;
  childId?: string;
  fulfilledAt?: string;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface RewardBoxItemDTO {
  id: string;
  name: string;
  quantity: number;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface BuffDTO {
  id: string;
  name: string;
  duration: number;
  unit: string;
  multiplier?: number;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface FreeTimeTaskDTO {
  id: string;
  name: string;
  durationMinutes: number;
  startedAt?: string;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface BountyTaskDTO {
  id: string;
  name: string;
  points: number;
  createdBy?: string;
  createdAt?: string;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface BountySubmissionDTO {
  id: string;
  taskId: string;
  startedAt: string;
  proof?: string;
  status?: string;
  isDeleted?: boolean;
  lastModified?: string;
  [key: string]: unknown;
}

export interface BountyCompletionDTO {
  id: string;
  taskId: string;
  points: number;
  completedAt?: string;
  lastModified?: string;
  [key: string]: unknown;
}

export interface SettingsDTO {
  subjects?: string[];
  dailyBasePoints?: number;
  ratingMultipliers?: Record<string, number>;
  [key: string]: unknown;
}

export interface EmailConfigDTO {
  host: string;
  port: number;
  user: string;
  password?: string;
  [key: string]: unknown;
}
