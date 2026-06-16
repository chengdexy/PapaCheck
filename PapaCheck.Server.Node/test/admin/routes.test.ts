import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { adminRoutes } from '../../src/admin/routes.js';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';
import bcrypt from 'bcryptjs';
import type { IDatabase } from '../../src/db/types.js';

describe('Admin Routes', () => {
  let app: FastifyInstance;

  // 用于测试的内存状态
  let storedTenants: Array<{ id: string; name: string; admin_id: string | null }> = [];
  let storedUsers: Array<{
    id: string;
    tenant_id: string;
    role: string;
    nickname: string;
    access_hash: string;
    token_version: number;
    is_active: boolean;
    created_at: string;
    last_login: string | null;
    email: string | null;
    password_hash: string | null;
  }> = [];

  // 预设一个已注册的管理员
  const adminPassword = 'testpass123';
  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
  const adminId = 'admin-001';
  const adminTenantId = 'tenant-001';
  const adminAccessHash = bcrypt.hashSync('pc-admin-hash', 10);
  const adminEmail = 'admin@test.com';

  // 预设一个 child 成员
  const childId = 'child-001';
  const childAccessHash = bcrypt.hashSync('pc-child-hash', 10);

  function resetState(): void {
    storedTenants = [
      { id: adminTenantId, name: '测试家庭', admin_id: adminId },
    ];
    storedUsers = [
      {
        id: adminId,
        tenant_id: adminTenantId,
        role: 'parent',
        nickname: 'admin',
        access_hash: adminAccessHash,
        token_version: 1,
        is_active: true,
        created_at: '2024-01-01T00:00:00.000Z',
        last_login: null,
        email: adminEmail,
        password_hash: adminPasswordHash,
      },
      {
        id: childId,
        tenant_id: adminTenantId,
        role: 'child',
        nickname: '测试孩子',
        access_hash: childAccessHash,
        token_version: 1,
        is_active: true,
        created_at: '2024-01-02T00:00:00.000Z',
        last_login: null,
        email: null,
        password_hash: null,
      },
    ];
  }
  resetState();

  const mockDb: IDatabase = {
    // 已有方法（桩）
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
    queryUserTokenVersion: async (_userId: string) => {
      const user = storedUsers.find(u => u.id === _userId);
      return user?.token_version ?? 1;
    },
    findUserByAccessHash: async (_accessHash: string) => null,
    getUserById: async (_userId: string) => null,
    updateUserLastLogin: async () => {},

    // === 新增的管理员/成员方法 ===
    createTenant: async (id: string, name: string) => {
      storedTenants.push({ id, name, admin_id: null });
    },
    createUser: async (input: any) => {
      storedUsers.push({
        id: input.id,
        tenant_id: input.tenant_id,
        role: input.role,
        nickname: input.nickname,
        access_hash: input.access_hash,
        token_version: input.token_version,
        is_active: true,
        created_at: new Date().toISOString(),
        last_login: null,
        email: input.email ?? null,
        password_hash: input.password_hash ?? null,
      });
    },
    findAdminByEmail: async (email: string) => {
      const user = storedUsers.find(u => u.email === email && u.is_active);
      if (!user) return null;
      return {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email!,
        password_hash: user.password_hash!,
        token_version: user.token_version,
      };
    },
    getTenantMembers: async (tenantId: string) => {
      return storedUsers
        .filter(u => u.tenant_id === tenantId && u.is_active)
        .map(u => ({
          id: u.id,
          tenant_id: u.tenant_id,
          role: u.role,
          nickname: u.nickname,
          access_hash: u.access_hash,
          token_version: u.token_version,
          last_login: u.last_login ?? undefined,
          created_at: u.created_at,
        }));
    },
    regenerateMemberHash: async (userId: string, tenantId: string, newHash: string, accessCode?: string) => {
      const user = storedUsers.find(u => u.id === userId && u.tenant_id === tenantId && u.is_active);
      if (!user) throw new Error('成员不存在或不属于该租户');
      user.access_hash = newHash;
      if (accessCode) (user as any).access_code = accessCode;
      user.token_version += 1;
    },
    deactivateMember: async (userId: string, tenantId: string) => {
      const user = storedUsers.find(u => u.id === userId && u.tenant_id === tenantId);
      if (user) { user.is_active = false; user.token_version += 1; }
    },
    updateTenantAdmin: async (tenantId: string, adminUserId: string) => {
      const tenant = storedTenants.find(t => t.id === tenantId);
      if (tenant) tenant.admin_id = adminUserId;
    },
    getAllTenants: async () => storedTenants.map(t => ({ id: t.id, name: t.name, is_active: true, member_count: 0, created_at: new Date().toISOString() })),
    updateTenantName: async (tenantId: string, newName: string) => { const t = storedTenants.find(t => t.id === tenantId); if (t) t.name = newName; },
  };

  beforeEach(() => {
    resetState();
  });

  beforeAll(async () => {
    app = Fastify();

    // 注册全局错误处理器，处理 Fastify schema 校验错误
    app.setErrorHandler((error: any, _request, reply) => {
      if (error.validation) {
        return reply.status(400).send({
          error: '请求参数校验失败',
          code: 'VALIDATION_ERROR',
          details: error.validation,
        });
      }
      return reply.status(500).send({ error: '服务器内部错误', code: 'INTERNAL_ERROR' });
    });

    // 注册 auth 中间件
    await authMiddleware(app, { db: mockDb });

    // 注册 admin 路由
    await adminRoutes(app, mockDb);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 注册 ====================

  // Feature: 管理员注册
  //   Scenario: 成功注册
  //     Given 有效的邮箱、密码和家庭名称
  //     When  调用 POST /api/auth/register
  //     Then  返回 200 包含 tenant_id 和 admin_hash

  it('should register a new admin successfully', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'newadmin@test.com',
        password: 'password123',
        family_name: '新家庭',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('tenant_id');
    expect(body).toHaveProperty('admin_hash');
    expect(body.admin_hash).toMatch(/^[A-Za-z2-9]{6}$/);
    expect(body.message).toBe('注册成功');
  });

  // Feature: 管理员注册
  //   Scenario: 缺少必填字段
  //     Given 缺少 email 的请求体
  //     When  调用 POST /api/auth/register
  //     Then  返回 400 错误

  it('should return 400 when register fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'test@test.com' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // Feature: 管理员注册
  //   Scenario: 密码长度不足
  //     Given 密码长度小于 6 位
  //     When  调用 POST /api/auth/register
  //     Then  返回 400 错误

  it('should return 400 when password is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'test@test.com',
        password: '12345',
        family_name: '测试',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // ==================== 登录 ====================

  // Feature: 管理员登录
  //   Scenario: 成功登录
  //     Given 正确的邮箱和密码
  //     When  调用 POST /api/auth/login
  //     Then  返回 200 包含 token 和 tenant_id

  it('should login successfully with valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: adminEmail,
        password: adminPassword,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('token');
    expect(body).toHaveProperty('tenant_id');
    expect(body.tenant_id).toBe(adminTenantId);
  });

  // Feature: 管理员登录
  //   Scenario: 密码错误
  //     Given 错误的密码
  //     When  调用 POST /api/auth/login
  //     Then  返回 401 错误

  it('should return 401 with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: adminEmail,
        password: 'wrongpassword',
      },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  // Feature: 管理员登录
  //   Scenario: 邮箱不存在
  //     Given 不存在的邮箱
  //     When  调用 POST /api/auth/login
  //     Then  返回 401 错误

  it('should return 401 with non-existent email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'nonexistent@test.com',
        password: 'password123',
      },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  // ==================== 成员管理 ====================

  // Feature: GET /api/admin/members
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 GET /api/admin/members
  //     Then  返回 401 错误

  it('should return 401 when accessing members without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/members',
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: GET /api/admin/members
  //   Scenario: child 角色访问
  //     Given 一个 child 角色的 JWT token
  //     When  调用 GET /api/admin/members
  //     Then  返回 403 错误

  it('should return 403 when child role accesses members', async () => {
    const childToken = signToken({
      sub: childId,
      tenant_id: adminTenantId,
      role: 'child',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/members',
      headers: {
        Authorization: `Bearer ${childToken}`,
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  // Feature: GET /api/admin/members
  //   Scenario: 管理员获取成员列表
  //     Given 一个 parent 角色的 JWT token
  //     When  调用 GET /api/admin/members
  //     Then  返回 200 包含成员列表

  it('should return members list for admin', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/members',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    // 至少包含管理员自己和 child
    expect(body.length).toBeGreaterThanOrEqual(2);
    const adminUser = body.find((m: any) => m.id === adminId);
    expect(adminUser).toBeDefined();
    expect(adminUser.role).toBe('parent');
  });

  // ==================== 添加成员 ====================

  // Feature: POST /api/admin/members
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 POST /api/admin/members
  //     Then  返回 401
  it('should return 401 when adding member without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/members',
      payload: { role: 'child', nickname: '新孩子' },
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: POST /api/admin/members
  //   Scenario: child 角色访问
  //     Given 一个 child 角色的 JWT
  //     When  调用 POST /api/admin/members
  //     Then  返回 403
  it('should return 403 when child role adds member', async () => {
    const childToken = signToken({
      sub: childId,
      tenant_id: adminTenantId,
      role: 'child',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: { Authorization: `Bearer ${childToken}` },
      payload: { role: 'child', nickname: '新孩子' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  // Feature: POST /api/admin/members
  //   Scenario: 缺少必填字段
  //     Given 缺少 nickname
  //     When  调用 POST /api/admin/members
  //     Then  返回 400
  it('should return 400 when member fields are missing', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { role: 'child' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  // Feature: POST /api/admin/members
  //   Scenario: 无效的角色值
  //     Given role 不是 parent 或 child
  //     When  调用 POST /api/admin/members
  //     Then  返回 400
  it('should return 400 when role is invalid', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { role: 'guest', nickname: '访客' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  // Feature: POST /api/admin/members
  //   Scenario: 管理员成功添加成员
  //     Given 有效的 parent JWT
  //     When  调用 POST /api/admin/members 添加一个 child 角色
  //     Then  返回 200 包含 id、access_hash（明文）
  it('should add a new member successfully', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { role: 'child', nickname: '新孩子' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('id');
    expect(body.nickname).toBe('新孩子');
    expect(body.role).toBe('child');
    expect(body.access_hash).toMatch(/^[A-Za-z2-9]{6}$/); // 返回明文访问码
    // 验证成员已存入存储
    const newMember = storedUsers.find(u => u.id === body.id);
    expect(newMember).toBeDefined();
    expect(newMember?.nickname).toBe('新孩子');
  });

  // ==================== 重新生成访问码 ====================

  // Feature: POST /api/admin/members/:id/regenerate
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 POST /api/admin/members/:id/regenerate
  //     Then  返回 401
  it('should return 401 when regenerating hash without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/members/${childId}/regenerate`,
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: POST /api/admin/members/:id/regenerate
  //   Scenario: child 角色访问
  //     Given 一个 child 角色的 JWT
  //     When  调用 POST /api/admin/members/:id/regenerate
  //     Then  返回 403
  it('should return 403 when child role regenerates hash', async () => {
    const childToken = signToken({
      sub: childId,
      tenant_id: adminTenantId,
      role: 'child',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/members/${adminId}/regenerate`,
      headers: { Authorization: `Bearer ${childToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  // Feature: POST /api/admin/members/:id/regenerate
  //   Scenario: 管理员成功重新生成访问码
  //     Given 有效的 parent JWT
  //     When  调用 POST /api/admin/members/:id/regenerate
  //     Then  返回 200 包含新 access_hash 明文，token_version 递增
  it('should regenerate hash successfully', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'parent',
      token_version: 1,
    });
    const oldTokenVersion = storedUsers.find(u => u.id === childId)?.token_version ?? 0;
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/members/${childId}/regenerate`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(childId);
    expect(body.access_code).toMatch(/^[A-Za-z2-9]{6}$/); // 返回明文访问码
    expect(body.message).toBe('已重新生成，旧访问码已失效');
    // 验证 token_version 已递增
    const updatedUser = storedUsers.find(u => u.id === childId);
    expect(updatedUser?.token_version).toBe(oldTokenVersion + 1);
  });

  // ==================== 移除成员 ====================

  // Feature: DELETE /api/admin/members/:id
  //   Scenario: 未认证访问
  //     Given 未携带 Authorization 头
  //     When  调用 DELETE /api/admin/members/:id
  //     Then  返回 401
  it('should return 401 when deleting member without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/members/${childId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: DELETE /api/admin/members/:id
  //   Scenario: child 角色访问
  //     Given 一个 child 角色的 JWT
  //     When  调用 DELETE /api/admin/members/:id
  //     Then  返回 403
  it('should return 403 when child role deletes member', async () => {
    const currentChildVersion = storedUsers.find(u => u.id === childId)?.token_version ?? 1;
    const childToken = signToken({
      sub: childId,
      tenant_id: adminTenantId,
      role: 'child',
      token_version: currentChildVersion,
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/members/${adminId}`,
      headers: { Authorization: `Bearer ${childToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  // Feature: DELETE /api/admin/members/:id
  //   Scenario: 管理员成功移除成员
  //     Given 有效的 parent JWT
  //     When  调用 DELETE /api/admin/members/:id
  //     Then  返回 200 且成员 is_active 变为 false，token_version 递增
  it('should delete a member successfully', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'parent',
      token_version: 1,
    });
    // 先添加一个临时成员用于删除
    const tempId = 'temp-child-001';
    storedUsers.push({
      id: tempId,
      tenant_id: adminTenantId,
      role: 'child',
      nickname: '待删除',
      access_hash: '$2a$10$dummy',
      token_version: 1,
      is_active: true,
      created_at: '2024-03-01T00:00:00.000Z',
      last_login: null,
      email: null,
      password_hash: null,
    });
    const oldTokenVersion = storedUsers.find(u => u.id === tempId)?.token_version ?? 0;
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/members/${tempId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // 验证成员已被停用且 token_version 递增
    const deletedUser = storedUsers.find(u => u.id === tempId);
    expect(deletedUser?.is_active).toBe(false);
    expect(deletedUser?.token_version).toBe(oldTokenVersion + 1);
  });

  // ==================== 注册不污染超管租户 ====================

  // Feature: 管理员注册 — 不复用超管系统租户
  //   Scenario: 注册时存在"系统管理"租户，不应复用该租户
  //     Given 数据库中已存在名为"系统管理"的租户（超管专用）
  //     When  用户调用 POST /api/auth/register 注册新家庭
  //     Then  应创建全新的租户，而非复用"系统管理"租户
  //     Then  注册完成后，新家庭的租户名称应为用户指定的 family_name
  //     Then  注册完成后，该租户下只有一个家长成员（不含超管）

  it('注册时存在系统管理租户不应复用', async () => {
    // 模拟 ensureSuperAdmin 创建的"系统管理"租户
    const superTenantId = 'super-tenant-001';
    const superUserId = 'super-user-001';
    storedTenants = [
      { id: superTenantId, name: '系统管理', admin_id: null },
    ];
    storedUsers = [
      {
        id: superUserId,
        tenant_id: superTenantId,
        role: 'parent',
        nickname: '超级管理员',
        access_hash: '', // 超管无访问码
        token_version: 1,
        is_active: true,
        created_at: '2024-01-01T00:00:00.000Z',
        last_login: null,
        email: 'admin',
        password_hash: bcrypt.hashSync('admin-test', 10),
      },
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'newfamily@test.com',
        password: 'password123',
        family_name: '我的新家庭',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // 不应复用系统管理租户的 ID
    expect(body.tenant_id).not.toBe(superTenantId);

    // 新租户的 name 应该是 family_name
    const newTenant = storedTenants.find(t => t.id === body.tenant_id);
    expect(newTenant).toBeDefined();
    expect(newTenant!.name).toBe('我的新家庭');

    // "系统管理"租户不应被改名（保持原名）
    const superTenant = storedTenants.find(t => t.id === superTenantId);
    expect(superTenant).toBeDefined();
    expect(superTenant!.name).toBe('系统管理');

    // 新家庭租户下只有一个家长成员（不包含超管用户）
    const newTenantParents = storedUsers.filter(
      u => u.tenant_id === body.tenant_id && u.role === 'parent' && u.is_active
    );
    expect(newTenantParents).toHaveLength(1);
    expect(newTenantParents[0].email).toBe('newfamily@test.com');
  });

  // Feature: 管理员注册 — 仍可复用"默认租户"
  //   Scenario: 注册时存在"默认租户"（旧版本遗留），应正常复用
  //     Given 数据库中已存在名为"默认租户"的租户（旧版本迁移遗留）
  //     When  用户调用 POST /api/auth/register 注册新家庭
  //     Then  应复用"默认租户"并更新为 family_name
  //     Then  注册完成后，该租户下只有一个家长成员

  it('注册时存在默认租户应正常复用', async () => {
    const legacyTenantId = 'legacy-tenant-001';
    storedTenants = [
      { id: legacyTenantId, name: '默认租户', admin_id: null },
    ];
    storedUsers = []; // 空用户表

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'newfamily2@test.com',
        password: 'password123',
        family_name: '我的第二个家庭',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);

    // 应复用"默认租户"的 ID
    expect(body.tenant_id).toBe(legacyTenantId);

    // 租户 name 应更新为 family_name
    const reusedTenant = storedTenants.find(t => t.id === legacyTenantId);
    expect(reusedTenant).toBeDefined();
    expect(reusedTenant!.name).toBe('我的第二个家庭');

    // 该租户下只有一个家长成员
    const parents = storedUsers.filter(
      u => u.tenant_id === legacyTenantId && u.role === 'parent' && u.is_active
    );
    expect(parents).toHaveLength(1);
    expect(parents[0].email).toBe('newfamily2@test.com');
  });
});
