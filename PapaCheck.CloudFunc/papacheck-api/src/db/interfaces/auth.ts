import type { UserRecord, AdminUser, AccessCodeRecord, ChildrenRecord, CreateUserInput, CreateAccessCodeInput, TenantListItem } from '../types.js';
export interface IAuthStore {
  queryUserTokenVersion(userId: string): Promise<number>;
  findUserByAccessHash(accessHash: string): Promise<UserRecord | null>;
  findUserByAccessCode(accessCode: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  updateUserLastLogin(userId: string): Promise<void>;
  updateAccessCodeLastLogin(id: string): Promise<void>;
  createUser(input: CreateUserInput): Promise<void>;
  findAdminByEmail(email: string): Promise<AdminUser | null>;
  findAdminExists(): Promise<boolean>;
  findUserByEmail(email: string): Promise<any | null>;
  updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<void>;
  getAllTenants(): Promise<TenantListItem[]>;
  setTenantActive(tenantId: string, isActive: boolean): Promise<void>;
  createTenant(id: string, name: string): Promise<void>;
  createAccessCode(input: CreateAccessCodeInput): Promise<string>;
  getAccessCodesByUser(userId: string): Promise<AccessCodeRecord[]>;
  findAccessCodeByCode(code: string): Promise<AccessCodeRecord | null>;
  getAccessCodeById(id: string): Promise<AccessCodeRecord | null>;
  regenerateAccessCode(id: string, userId: string): Promise<string>;
  deleteAccessCode(id: string, userId: string): Promise<void>;
  createChild(tenantId: string, name: string, accessCodeId?: string): Promise<ChildrenRecord>;
  getChildById(id: string, tenantId: string): Promise<ChildrenRecord | null>;
  getChildrenByTenant(tenantId: string, activeOnly?: boolean): Promise<ChildrenRecord[]>;
  updateChild(id: string, tenantId: string, fields: { name?: string; is_active?: boolean; access_code_id?: string | null }): Promise<void>;
  findChildByAccessCodeId(accessCodeId: string, tenantId: string): Promise<ChildrenRecord | null>;
  assignLegacyDataToChild(tenantId: string, childId: string): Promise<void>;
}
