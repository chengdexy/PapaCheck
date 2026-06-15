/**
 * super-admin-routes.test.ts - 超级管理员路由测试
 *
 * 测试覆盖：
 * - POST /api/admin/super/login — 超级管理员登录
 * - PUT /api/admin/super/credentials — 修改凭证
 * - GET /api/admin/super/tenants — 租户列表
 * - PATCH /api/admin/super/tenants/:id — 启用/禁用租户
 * - 角色权限检查（非 super_admin 角色被拒绝）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { superAdminRoutes } from '../../src/auth/super-admin-routes.js';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';
import type { IDatabase, AdminUser } from '../../src/db/types.js';

describe('Super Admin Routes', () => {
  let app: FastifyInstance;

  // ==================== 模拟数据 ====================
  const superAdminId = 'super-admin-001';
  const superAdminPassword = 'admin-test123';
  const superAdminPasswordHash = bcrypt.hashSync(superAdminPassword, 10);

  let storedSuperAdmin: AdminUser = {
    id: superAdminId,
    tenant_id: '__super_admin__',
    email: 'admin',
    password_hash: superAdminPasswordHash,
    token_version: 1,
  };

  let storedTenants: Array<{ id: string; name: string; is_active: boolean; member_count: number; created_at: string }> = [];

  // 预置两个租户
  const tenant1Id = 'tenant-001';
  const tenant2Id = 'tenant-002';

  function resetState(): void {
    storedSuperAdmin = {
      id: superAdminId,
      tenant_id: '__super_admin__',
      email: 'admin',
      password_hash: superAdminPasswordHash,
      token_version: 1,
    };
    storedTenants = [
      { id: tenant1Id, name: '家庭A', is_active: true, member_count: 3, created_at: '2024-01-01T00:00:00.000Z' },
      { id: tenant2Id, name: '家庭B', is_active: false, member_count: 1, created_at: '2024-02-01T00:00:00.000Z' },
    ];
  }
  resetState();

  // ==================== 模拟 DB ====================
  const mockDb: IDatabase & { pool?: any } = {
    pool: {
      query: async (sql: string, params: any[]) => {
        if (sql.includes('SELECT password_hash FROM users')) {
          if (params[0] === superAdminId) {
            return { rows: [{ password_hash: superAdminPasswordHash }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
    },
    // Super Admin 方法
    findSuperAdmin: async (username: string) => {
      if (username === storedSuperAdmin.email) {
        return { ...storedSuperAdmin };
      }
      return null;
    },
    updateSuperAdminCredentials: async (userId: string, email: string, passwordHash: string) => {
      if (userId === storedSuperAdmin.id) {
        storedSuperAdmin.email = email;
        storedSuperAdmin.password_hash = passwordHash;
        storedSuperAdmin.token_version += 1;
      }
    },
    getAllTenants: async () => [...storedTenants],
    setTenantActive: async (tenantId: string, isActive: boolean) => {
      const tenant = storedTenants.find(t => t.id === tenantId);
      if (tenant) tenant.is_active = isActive;
    },

    // IDatabase 其他必须的桩方法
    close: async () => {},
    getFullData: async () => ({} as any),
    importFullData: async () => {},
    addNotification: async () => 'notif-id',
    getPendingNotifications: async () => [],
    consumeNotifications: async () => {},
    getPointsBalance: async () => 0,
    updatePoints: async () => 0,
    patchPoints: async () => 0,
    getHomeworks: async () => [],
    saveHomeworks: async () => {},
    moveHomework: async () => null,
    getHomeworkById: async () => null,
    putHomework: async () => {},
    patchHomework: async () => {},
    deleteHomework: async () => {},
    getSettlement: async () => null,
    saveSettlement: async () => {},
    putSettlement: async () => {},
    patchSettlement: async () => {},
    getShopItems: async () => [],
    saveShopItems: async () => {},
    getShopItemById: async () => null,
    putShopItem: async () => {},
    deleteShopItem: async () => {},
    getRedemptions: async () => [],
    saveRedemptions: async () => {},
    clearFulfilledRedemptions: async () => {},
    putRedemption: async () => {},
    getRewardBox: async () => [],
    saveRewardBox: async () => {},
    putRewardBoxItem: async () => {},
    deleteRewardBoxItem: async () => {},
    getSettings: async () => ({}),
    saveSettings: async () => {},
    putSettings: async () => {},
    patchSettings: async () => {},
    getActiveBuffs: async () => [],
    saveActiveBuffs: async () => {},
    putBuff: async () => {},
    deleteBuff: async () => {},
    getEfficiency: async () => null,
    saveEfficiency: async () => {},
    putEfficiency: async () => {},
    getFreeTime: async () => [],
    saveFreeTime: async () => {},
    putFreeTimeTask: async () => {},
    getBountyTasks: async () => [],
    saveBountyTasks: async () => {},
    getBountyTaskById: async () => null,
    putBountyTask: async () => {},
    deleteBountyTask: async () => {},
    getBountySubmissions: async () => [],
    saveBountySubmissions: async () => {},
    putBountySubmission: async () => {},
    getBountyCompletions: async () => ({}),
    saveBountyCompletions: async () => {},
    putBountyCompletion: async () => {},
    getEmailConfig: async () => null,
    saveEmailConfig: async () => {},
    getModifiedSince: async () => [],
    pushMerge: async () => ({ ok: true }),
    recordModification: async () => {},
    resetDate: async () => {},
    saveCRDTOperation: async () => {},
    applyCRDTOperation: async () => {},
    getCRDTOperationsSince: async () => [],
    ackCRDTOperations: async () => {},
    queryUserTokenVersion: async () => 1,
    findUserByAccessHash: async () => null,
    getUserById: async () => null,
    updateUserLastLogin: async () => {},
    createTenant: async () => {},
    createUser: async () => {},
    findAdminByEmail: async () => null,
    getTenantMembers: async () => [],
    regenerateMemberHash: async () => {},
    deactivateMember: async () => {},
    updateTenantAdmin: async () => {},
    updateTenantName: async () => {},
  };

  // ==================== 应用启动 ====================
  beforeEach(() => {
    resetState();
  });

  beforeAll(async () => {
    app = Fastify();

    await authMiddleware(app, { db: mockDb });
    await superAdminRoutes(app, mockDb);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 登录 ====================

  // Feature: POST /api/admin/super/login
  //   Scenario: 缺少必填字段
  //     Given 请求体中缺少 username
  //     When  调用 POST /api/admin/super/login
  //     Then  返回 400
  it('should return 400 when login fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/super/login',
      payload: { username: 'admin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  // Feature: POST /api/admin/super/login
  //   Scenario: 用户名不存在
  //     Given 一个不存在的用户名
  //     When  调用 POST /api/admin/super/login
  //     Then  返回 401
  it('should return 401 with non-existent username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/super/login',
      payload: { username: 'nonexistent', password: 'test123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  // Feature: POST /api/admin/super/login
  //   Scenario: 密码错误
  //     Given 正确的用户名但错误的密码
  //     When  调用 POST /api/admin/super/login
  //     Then  返回 401
  it('should return 401 with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/super/login',
      payload: { username: 'admin', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  // Feature: POST /api/admin/super/login
  //   Scenario: 成功登录
  //     Given 正确的用户名和密码
  //     When  调用 POST /api/admin/super/login
  //     Then  返回 200 包含 token
  it('should login successfully with valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/super/login',
      payload: { username: 'admin', password: superAdminPassword },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('token');
    expect(body.username).toBe('admin');
  });

  // ==================== 修改凭证 ====================

  // Feature: PUT /api/admin/super/credentials
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 PUT /api/admin/super/credentials
  //     Then  返回 401
  it('should return 401 when updating credentials without auth', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/super/credentials',
      payload: { username: 'newadmin', password: 'newpass123' },
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: PUT /api/admin/super/credentials
  //   Scenario: 非 super_admin 角色访问
  //     Given 一个 parent 角色的 JWT
  //     When  调用 PUT /api/admin/super/credentials
  //     Then  返回 403
  it('should return 403 when non-super-admin updates credentials', async () => {
    const parentToken = signToken({
      sub: 'parent-001',
      tenant_id: 'tenant-001',
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/super/credentials',
      headers: { Authorization: `Bearer ${parentToken}` },
      payload: { username: 'newadmin', password: 'newpass123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  // Feature: PUT /api/admin/super/credentials
  //   Scenario: 缺少必填字段
  //     Given 只提供了 username 缺少 password
  //     When  调用 PUT /api/admin/super/credentials
  //     Then  返回 400
  it('should return 400 when credentials fields are missing', async () => {
    const superToken = signToken({
      sub: superAdminId,
      tenant_id: '__super_admin__',
      role: 'super_admin',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/super/credentials',
      headers: { Authorization: `Bearer ${superToken}` },
      payload: { username: 'newadmin' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  // Feature: PUT /api/admin/super/credentials
  //   Scenario: 密码长度不足
  //     Given 密码长度小于 6 位
  //     When  调用 PUT /api/admin/super/credentials
  //     Then  返回 400
  it('should return 400 when password is too short', async () => {
    const superToken = signToken({
      sub: superAdminId,
      tenant_id: '__super_admin__',
      role: 'super_admin',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/super/credentials',
      headers: { Authorization: `Bearer ${superToken}` },
      payload: { username: 'newadmin', password: '12345' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  // Feature: PUT /api/admin/super/credentials
  //   Scenario: 成功修改凭证
  //     Given 有效的 super_admin JWT 和新凭证
  //     When  调用 PUT /api/admin/super/credentials
  //     Then  返回 200
  it('should update credentials successfully', async () => {
    const superToken = signToken({
      sub: superAdminId,
      tenant_id: '__super_admin__',
      role: 'super_admin',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/super/credentials',
      headers: { Authorization: `Bearer ${superToken}` },
      payload: { username: 'updated-admin', password: 'newpass123', current_password: superAdminPassword },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().message).toBe('凭证已更新');
    // 验证 token_version 已递增
    expect(storedSuperAdmin.token_version).toBe(2);
    expect(storedSuperAdmin.email).toBe('updated-admin');
  });

  // ==================== 租户列表 ====================

  // Feature: GET /api/admin/super/tenants
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 GET /api/admin/super/tenants
  //     Then  返回 401
  it('should return 401 when listing tenants without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/super/tenants' });
    expect(res.statusCode).toBe(401);
  });

  // Feature: GET /api/admin/super/tenants
  //   Scenario: 非 super_admin 角色访问
  //     Given 一个 parent 角色的 JWT
  //     When  调用 GET /api/admin/super/tenants
  //     Then  返回 403
  it('should return 403 when non-super-admin lists tenants', async () => {
    const childToken = signToken({
      sub: 'child-001',
      tenant_id: 'tenant-001',
      role: 'child',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/super/tenants',
      headers: { Authorization: `Bearer ${childToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // Feature: GET /api/admin/super/tenants
  //   Scenario: 成功获取租户列表
  //     Given 有效的 super_admin JWT
  //     When  调用 GET /api/admin/super/tenants
  //     Then  返回 200 包含租户列表
  it('should return tenants list', async () => {
    const superToken = signToken({
      sub: superAdminId,
      tenant_id: '__super_admin__',
      role: 'super_admin',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/super/tenants',
      headers: { Authorization: `Bearer ${superToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    const tenantA = body.find((t: any) => t.id === tenant1Id);
    expect(tenantA).toBeDefined();
    expect(tenantA.name).toBe('家庭A');
  });

  // ==================== 启用/禁用租户 ====================

  // Feature: PATCH /api/admin/super/tenants/:id
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 PATCH /api/admin/super/tenants/:id
  //     Then  返回 401
  it('should return 401 when toggling tenant without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/super/tenants/${tenant1Id}`,
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: PATCH /api/admin/super/tenants/:id
  //   Scenario: 非 super_admin 角色访问
  //     Given 一个 parent 角色的 JWT
  //     When  调用 PATCH /api/admin/super/tenants/:id
  //     Then  返回 403
  it('should return 403 when non-super-admin toggles tenant', async () => {
    const parentToken = signToken({
      sub: 'parent-001',
      tenant_id: 'tenant-001',
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/super/tenants/${tenant1Id}`,
      headers: { Authorization: `Bearer ${parentToken}` },
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(403);
  });

  // Feature: PATCH /api/admin/super/tenants/:id
  //   Scenario: is_active 不是布尔值
  //     Given is_active 为字符串而非布尔值
  //     When  调用 PATCH /api/admin/super/tenants/:id
  //     Then  返回 400
  it('should return 400 when is_active is not boolean', async () => {
    const superToken = signToken({
      sub: superAdminId,
      tenant_id: '__super_admin__',
      role: 'super_admin',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/super/tenants/${tenant1Id}`,
      headers: { Authorization: `Bearer ${superToken}` },
      payload: { is_active: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  // Feature: PATCH /api/admin/super/tenants/:id
  //   Scenario: 成功禁用租户
  //     Given 有效的 super_admin JWT
  //     When  调用 PATCH 将 is_active 设为 false
  //     Then  返回 200 且租户被禁用
  it('should disable a tenant successfully', async () => {
    const superToken = signToken({
      sub: superAdminId,
      tenant_id: '__super_admin__',
      role: 'super_admin',
      token_version: 1,
    });
    expect(storedTenants.find(t => t.id === tenant1Id)?.is_active).toBe(true);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/super/tenants/${tenant1Id}`,
      headers: { Authorization: `Bearer ${superToken}` },
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(storedTenants.find(t => t.id === tenant1Id)?.is_active).toBe(false);
    // 恢复
    storedTenants.find(t => t.id === tenant1Id)!.is_active = true;
  });
});
