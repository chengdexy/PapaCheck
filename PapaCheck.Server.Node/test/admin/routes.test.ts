import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { adminRoutes } from '../../src/admin/routes.js';
import { authRoutes } from '../../src/auth/routes.js';
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

  let storedAccessCodes: Array<{
    id: string;
    user_id: string;
    type: 'parent' | 'child';
    code_hash: string;
    nickname: string;
    created_at: string;
  }> = [];

  // 预设一个已注册的管理员（user 角色）
  const adminPassword = 'testpass123';
  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
  const adminId = 'admin-001';
  const adminTenantId = 'tenant-001';
  const adminEmail = 'admin@test.com';

  // 预设一个 child 访问码
  const childId = 'child-001';
  const childCode = 'pc-child';
  const childCodeHash = bcrypt.hashSync(childCode, 10);

  function resetState(): void {
    storedTenants = [
      { id: adminTenantId, name: '测试家庭', admin_id: adminId },
    ];
    storedUsers = [
      {
        id: adminId,
        tenant_id: adminTenantId,
        role: 'user',
        nickname: 'admin',
        access_hash: '',
        token_version: 1,
        is_active: true,
        created_at: '2024-01-01T00:00:00.000Z',
        last_login: null,
        email: adminEmail,
        password_hash: adminPasswordHash,
      },
    ];
    storedAccessCodes = [
      {
        id: childId,
        user_id: adminId,
        type: 'child',
        code_hash: childCodeHash,
        nickname: '测试孩子',
        created_at: '2024-01-02T00:00:00.000Z',
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
    findUserByAccessHash: async () => null,
    findUserByAccessCode: async () => null,
    getUserById: async (_userId: string) => null,
    updateUserLastLogin: async () => {},
    updateAccessCodeLastLogin: async () => {},

    // === access_codes 相关方法 ===
    createAccessCode: async (input: any) => {
      storedAccessCodes.push({
        id: input.id,
        user_id: input.user_id,
        type: input.type,
        code_hash: input.code_hash,
        nickname: input.nickname,
        created_at: new Date().toISOString(),
      });
      return input.id;
    },
    getAccessCodesByUser: async (userId: string) => storedAccessCodes.filter(c => c.user_id === userId),
    findAccessCodeByCode: async (code: string) => {
      for (const c of storedAccessCodes) {
        if (bcrypt.compareSync(code, c.code_hash)) return c;
      }
      return null;
    },
    getAccessCodeById: async (id: string) => storedAccessCodes.find(c => c.id === id) ?? null,
    regenerateAccessCode: async (id: string, userId: string) => {
      const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
      let raw = '';
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        raw += chars[bytes[i] % chars.length];
      }
      const hash = bcrypt.hashSync(raw, 10);
      const idx = storedAccessCodes.findIndex(c => c.id === id && c.user_id === userId);
      if (idx === -1) throw new Error('not found');
      storedAccessCodes[idx].code_hash = hash;
      return raw;
    },
    deleteAccessCode: async (id: string, userId: string) => {
      storedAccessCodes = storedAccessCodes.filter(c => !(c.id === id && c.user_id === userId));
    },

    // === auth routes 需要的方法 ===
    createTenant: async (id: string, name: string) => {
      storedTenants.push({ id, name, admin_id: null });
    },
    deleteTenant: async (id: string) => {
      storedTenants = storedTenants.filter(t => t.id !== id);
    },
    createUser: async (input: any) => {
      storedUsers.push({
        id: input.id,
        tenant_id: input.tenant_id ?? '',
        role: input.role,
        nickname: input.nickname ?? '',
        access_hash: input.access_hash ?? '',
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
    findUserByEmail: async (email: string) => {
      return storedUsers.find(u => u.email === email) || null;
    },
    updateTenantAdmin: async (tenantId: string, adminUserId: string) => {
      const tenant = storedTenants.find(t => t.id === tenantId);
      if (tenant) tenant.admin_id = adminUserId;
    },
    updateTenantName: async (tenantId: string, newName: string) => { const t = storedTenants.find(t => t.id === tenantId); if (t) t.name = newName; },
    updateUserCredentials: async () => {},
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

    // 注册 auth 路由（register/login 端点）
    await authRoutes(app, mockDb);

    // 注册 admin 路由
    await adminRoutes(app, mockDb);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== 注册 ====================

  // Feature: 用户注册
  //   Scenario: 成功注册
  //     Given 有效的邮箱、密码和家庭名称
  //     When  调用 POST /api/auth/register
  //     Then  返回 200 包含 token、role 和 family_name

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
    expect(body).toHaveProperty('token');
    expect(body.role).toBe('user');
    expect(body.family_name).toBe('新家庭');
  });

  // Feature: 管理员注册
  //   Scenario: 重复邮箱注册
  //     Given 邮箱已被注册（含已禁用用户）
  //     When  调用 POST /api/auth/register
  //     Then  返回 409 冲突错误

  it('should return 409 when email already registered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: adminEmail, password: 'testpass123', family_name: '张家' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toContain('邮箱');
    expect(body.code).toBe('EMAIL_EXISTS');
  });

  it('should return 500 when user creation fails', async () => {
    const originalCreateUser = mockDb.createUser;
    mockDb.createUser = async () => { throw new Error('DB error'); };

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'newuser@test.com', password: 'testpass123', family_name: '张家' },
    });
    expect(res.statusCode).toBe(500);

    mockDb.createUser = originalCreateUser;
  });

  it('should return 409 when email belongs to disabled user', async () => {
    // 先禁用已注册用户，模拟故障家庭清理后的场景
    const disabledUser = storedUsers.find(u => u.email === adminEmail);
    expect(disabledUser).toBeDefined();
    disabledUser!.is_active = false;

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: adminEmail, password: 'testpass123', family_name: '张家' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toContain('邮箱');
    expect(body.code).toBe('EMAIL_EXISTS');
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

  // Feature: 用户登录
  //   Scenario: 成功登录
  //     Given 正确的邮箱和密码
  //     When  调用 POST /api/auth/login
  //     Then  返回 200 包含 token 和 role

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
    expect(body.role).toBe('user');
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
  //   Scenario: 管理员获取访问码列表
  //     Given 一个 user 角色的 JWT token
  //     When  调用 GET /api/admin/members
  //     Then  返回 200 包含访问码列表

  it('should return members list for admin', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'user',
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
    // 返回该用户下的所有访问码
    expect(body.length).toBeGreaterThanOrEqual(1);
    const childEntry = body.find((m: any) => m.id === childId);
    expect(childEntry).toBeDefined();
    expect(childEntry.role).toBe('child');
    expect(childEntry.nickname).toBe('测试孩子');
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
      role: 'user',
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
      role: 'user',
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
  //   Scenario: 管理员成功添加访问码
  //     Given 有效的 user JWT
  //     When  调用 POST /api/admin/members 添加一个 child 类型访问码
  //     Then  返回 200 包含 id、access_code（明文）
  it('should add a new member successfully', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'user',
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
    expect(body.access_code).toMatch(/^[A-Za-z2-9]{6}$/); // 返回明文访问码
    // 验证访问码已存入存储
    const newCode = storedAccessCodes.find(c => c.id === body.id);
    expect(newCode).toBeDefined();
    expect(newCode?.nickname).toBe('新孩子');
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
  //     Given 有效的 user JWT
  //     When  调用 POST /api/admin/members/:id/regenerate
  //     Then  返回 200 包含新访问码明文
  it('should regenerate hash successfully', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'user',
      token_version: 1,
    });
    const oldCodeHash = storedAccessCodes.find(c => c.id === childId)?.code_hash;
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
    // 验证 code_hash 已更新
    const updatedCode = storedAccessCodes.find(c => c.id === childId);
    expect(updatedCode?.code_hash).not.toBe(oldCodeHash);
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
  //   Scenario: 管理员成功删除访问码
  //     Given 有效的 user JWT
  //     When  调用 DELETE /api/admin/members/:id
  //     Then  返回 200 且访问码被删除
  it('should delete a member successfully', async () => {
    const adminToken = signToken({
      sub: adminId,
      tenant_id: adminTenantId,
      role: 'user',
      token_version: 1,
    });
    // 先添加一个临时访问码用于删除
    const tempId = 'temp-child-001';
    storedAccessCodes.push({
      id: tempId,
      user_id: adminId,
      type: 'child',
      code_hash: '$2a$10$dummy',
      nickname: '待删除',
      created_at: '2024-03-01T00:00:00.000Z',
    });
    expect(storedAccessCodes.find(c => c.id === tempId)).toBeDefined();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/members/${tempId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // 验证访问码已被删除
    expect(storedAccessCodes.find(c => c.id === tempId)).toBeUndefined();
  });

  // ==================== 注册不污染超管租户 ====================

  // Feature: 用户注册 — 存在系统管理租户不影响注册
  //   Scenario: 系统存在"系统管理"租户时仍可正常注册
  //     Given 数据库中已存在名为"系统管理"的租户
  //     When  用户调用 POST /api/auth/register
  //     Then  返回 200 并创建新的 user 账号

  it('注册时存在系统管理租户不影响注册', async () => {
    const superTenantId = 'super-tenant-001';
    const superUserId = 'super-user-001';
    storedTenants = [
      { id: superTenantId, name: '系统管理', admin_id: null },
    ];
    storedUsers = [
      {
        id: superUserId,
        tenant_id: superTenantId,
        role: 'user',
        nickname: '超级管理员',
        access_hash: '',
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
    expect(body.role).toBe('user');
    expect(body.family_name).toBe('我的新家庭');

    // 验证新用户已创建
    const newUser = storedUsers.find(u => u.email === 'newfamily@test.com');
    expect(newUser).toBeDefined();
    expect(newUser?.role).toBe('user');
  });

  // Feature: 用户注册 — 存在默认租户不影响注册
  //   Scenario: 系统存在"默认租户"时仍可正常注册
  //     Given 数据库中已存在名为"默认租户"的租户
  //     When  用户调用 POST /api/auth/register
  //     Then  返回 200 并创建新的 user 账号

  it('注册时存在默认租户不影响注册', async () => {
    storedTenants = [
      { id: 'legacy-tenant-001', name: '默认租户', admin_id: null },
    ];
    storedUsers = [];

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
    expect(body.role).toBe('user');
    expect(body.family_name).toBe('我的第二个家庭');

    // 验证新用户已创建
    const newUser = storedUsers.find(u => u.email === 'newfamily2@test.com');
    expect(newUser).toBeDefined();
    expect(newUser?.role).toBe('user');
  });
});
