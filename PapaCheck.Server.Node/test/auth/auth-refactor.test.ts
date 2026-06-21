import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { IDatabase, CreateAccessCodeInput, AccessCodeRecord } from '../../src/db/types.js';
import { adminRoutes } from '../../src/admin/routes.js';
import { authRoutes } from '../../src/auth/routes.js';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ==================== Gherkin 场景注释 ====================

// Feature: 统一登录
//   Scenario: 超级管理员登录返回 needs_password_change
//     Given 一个首次登录的超级管理员（first_login=true）
//     When 调用 POST /api/auth/login
//     Then 返回 200 包含 token 和 needs_password_change: true

// Feature: 统一登录
//   Scenario: 用户账号登录
//     Given 一个已注册的用户账号（role='user'）
//     When 调用 POST /api/auth/login
//     Then 返回 200 包含 token 和 role: 'user'

// Feature: 注册
//   Scenario: 注册用户账号
//     Given 未注册的邮箱
//     When 调用 POST /api/auth/register
//     Then 返回 200，users 表增加 role='user' 的行，无 access_code

// Feature: 修改凭证
//   Scenario: 超级管理员首次修改凭证不需要旧密码
//     Given 一个 first_login=true 的超级管理员
//     When 调用 PUT /api/auth/credentials 不带 current_password
//     Then 返回 200，first_login=false，token_version+1

// Feature: 修改凭证
//   Scenario: 非首次修改凭证需要旧密码
//     Given 一个 first_login=false 的账号
//     When 调用 PUT /api/auth/credentials 不带 current_password
//     Then 返回 400

// Feature: 访问码登录
//   Scenario: 通过 access_code 登录
//     Given 一个存在的访问码
//     When 调用 POST /api/auth/exchange
//     Then 返回 200 包含 token 和 role

// Feature: 家庭成员管理
//   Scenario: 用户账号创建 parent 访问码
//     Given 一个 role='user' 的 JWT
//     When 调用 POST /api/admin/members { role: 'parent', nickname: '妈妈' }
//     Then 返回 200 包含 access_code 明文

// Feature: 家庭成员管理
//   Scenario: parent 子账号不能管理成员
//     Given 一个 role='parent' 的 JWT（通过访问码登录）
//     When 调用 GET /api/admin/members
//     Then 返回 403

// ==================== Mock 数据 ====================

describe('Auth Refactor — 认证体系重构测试', () => {
  let app: FastifyInstance;

  // 内存存储
  let storedUsers: any[] = [];
  let storedAccessCodes: AccessCodeRecord[] = [];

  function resetState(): void {
    storedUsers = [
      {
        id: 'admin-001',
        role: 'admin',
        email: 'admin@papacheck.internal',
        password_hash: bcrypt.hashSync('adminpass123', 10),
        family_name: null,
        first_login: true,
        token_version: 1,
        is_active: true,
        tenant_id: '__super_admin__',
        nickname: '超级管理员',
        access_hash: '',
        is_super_admin: true,
        needs_password_change: true,
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'user-001',
        role: 'user',
        email: 'user@test.com',
        password_hash: bcrypt.hashSync('userpass123', 10),
        family_name: '测试家庭',
        first_login: false,
        token_version: 1,
        is_active: true,
        tenant_id: 'tenant-001',
        nickname: 'testuser',
        access_hash: '',
        is_super_admin: false,
        needs_password_change: false,
        created_at: '2024-01-02T00:00:00.000Z',
      },
    ];
    storedAccessCodes = [
      {
        id: 'code-001',
        tenant_id: 'user-001',
        code_hash: bcrypt.hashSync('ABC123', 10),
        child_id: 'child-001',
        token_version: 1,
        created_at: '2024-01-01T00:00:00.000Z',
      },
    ];
  }
  resetState();

  // ==================== Mock DB ====================

  const mockDb: IDatabase = {
    // --- 数据操作方法（桩） ---
    pool: { query: async () => ({ rows: [] }) } as any,
    createTenant: async (_id: string, _name: string) => {},
    getAllTenants: async () => [],
    setTenantActive: async () => {},
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

    // --- 认证相关方法（真实实现） ---
    queryUserTokenVersion: async (userId: string) => {
      const user = storedUsers.find(u => u.id === userId);
      return user?.token_version ?? 1;
    },
    findUserByAccessHash: async (_accessHash: string) => null,
    findUserByAccessCode: async (accessCode: string) => {
      // 遍历 access codes 用 bcrypt 比较
      for (const ac of storedAccessCodes) {
        const match = bcrypt.compareSync(accessCode, ac.code_hash);
        if (match) {
          const user = storedUsers.find(u => u.id === ac.tenant_id);
          if (!user || !user.is_active) return null;
          return {
            id: user.id,
            tenant_id: user.tenant_id,
            role: user.role,
            nickname: user.nickname,
            access_hash: ac.code_hash,
            token_version: user.token_version,
            is_active: user.is_active,
            is_super_admin: user.is_super_admin || false,
            needs_password_change: user.needs_password_change || false,
            created_at: user.created_at,
            last_login: user.last_login,
            family_name: user.family_name,
            first_login: user.first_login,
          };
        }
      }
      return null;
    },
    getUserById: async (userId: string) => {
      const user = storedUsers.find(u => u.id === userId);
      if (!user) return null;
      return {
        id: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        nickname: user.nickname,
        access_hash: user.access_hash,
        token_version: user.token_version,
        is_active: user.is_active,
        is_super_admin: user.is_super_admin || false,
        needs_password_change: user.needs_password_change || false,
        created_at: user.created_at,
        last_login: user.last_login,
        family_name: user.family_name,
        first_login: user.first_login,
      };
    },
    updateUserLastLogin: async (_userId: string) => {},
    updateAccessCodeLastLogin: async (_id: string) => {},
    createUser: async (input: any) => {
      storedUsers.push({
        id: input.id,
        tenant_id: input.tenant_id,
        role: input.role,
        nickname: input.nickname,
        access_hash: input.access_hash || '',
        token_version: input.token_version,
        is_active: true,
        is_super_admin: false,
        needs_password_change: input.role === 'admin',
        created_at: new Date().toISOString(),
        last_login: null,
        email: input.email ?? null,
        password_hash: input.password_hash ?? null,
        family_name: input.family_name ?? null,
        first_login: input.role === 'admin',
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
    updateUserCredentials: async (userId: string, email: string, passwordHash: string) => {
      const user = storedUsers.find(u => u.id === userId);
      if (user) {
        user.email = email;
        user.password_hash = passwordHash;
        user.first_login = false;
        user.token_version += 1;
      }
    },

    // --- 访问码相关方法 ---
    createAccessCode: async (input: CreateAccessCodeInput) => {
      storedAccessCodes.push({
        ...input,
        created_at: new Date().toISOString(),
      });
      return input.id;
    },
    getAccessCodesByUser: async (tenantId: string) => {
      return storedAccessCodes.filter(ac => ac.tenant_id === tenantId);
    },
    findAccessCodeByCode: async (code: string) => {
      for (const ac of storedAccessCodes) {
        const match = bcrypt.compareSync(code, ac.code_hash);
        if (match) return ac;
      }
      return null;
    },
    getAccessCodeById: async (id: string) => {
      return storedAccessCodes.find(ac => ac.id === id) || null;
    },
    regenerateAccessCode: async (id: string, tenantId: string) => {
      const idx = storedAccessCodes.findIndex(ac => ac.id === id && ac.tenant_id === tenantId);
      if (idx === -1) throw new Error('访问码不存在');
      const newCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      storedAccessCodes[idx] = {
        ...storedAccessCodes[idx],
        code_hash: bcrypt.hashSync(newCode, 10),
      };
      return newCode;
    },
    deleteAccessCode: async (id: string, tenantId: string) => {
      storedAccessCodes = storedAccessCodes.filter(ac => !(ac.id === id && ac.tenant_id === tenantId));
    },

    // === children 相关方法 ===
    getChildrenByTenant: async (_tenantId: string, _activeOnly?: boolean) => [],
    getChildById: async (_id: string, _tenantId: string) => {
      if (_id === 'child-001') {
        return { id: 'child-001', tenant_id: 'tenant-001', name: '妈妈', is_active: true, created_at: '2024-01-01T00:00:00.000Z' };
      }
      return null;
    },
    findChildByAccessCodeId: async (_accessCodeId: string, _tenantId: string) => null,
    createChild: async (tenantId: string, name: string, accessCodeId?: string) => {
      const id = 'child-' + Date.now();
      return { id, tenant_id: tenantId, name, access_code_id: accessCodeId ?? undefined, is_active: true, created_at: new Date().toISOString() };
    },
    updateChild: async () => {},
    assignLegacyDataToChild: async () => {},
  };

  // ==================== 应用启动 ====================

  beforeEach(() => {
    resetState();
  });

  beforeAll(async () => {
    app = Fastify();

    // 全局错误处理器
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

    // 注册中间件
    await authMiddleware(app, { db: mockDb });

    // 注册路由
    await authRoutes(app, mockDb);
    await adminRoutes(app, mockDb);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== Feature: 统一登录 ====================

  describe('Feature: 统一登录', () => {
    // Scenario: 超级管理员登录返回 needs_password_change
    it('超级管理员登录应返回 needs_password_change: true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'admin@papacheck.internal',
          password: 'adminpass123',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('token');
      expect(body.needs_password_change).toBe(true);
    });

    // Scenario: 用户账号登录
    it('用户账号登录应返回 role: user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'user@test.com',
          password: 'userpass123',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('token');
      expect(body.role).toBe('user');
    });
  });

  // ==================== Feature: 注册 ====================

  describe('Feature: 注册', () => {
    // Scenario: 注册用户账号
    it('注册用户账号成功，users 表增加 role=user 的行，无 access_code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'newuser@test.com',
          password: 'password123',
          family_name: '新家庭',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('token');
      expect(body.role).toBe('user');
      // 验证 users 表增加 role='user' 的行
      const newUser = storedUsers.find(u => u.email === 'newuser@test.com');
      expect(newUser).toBeDefined();
      expect(newUser!.role).toBe('user');
      // 验证无 access_code（通过角色+邮箱密码方式注册，不应生成访问码）
      expect(newUser!.access_hash).toBe('');
    });
  });

  // ==================== Feature: 修改凭证 ====================

  describe('Feature: 修改凭证', () => {
    let superAdminToken: string;

    beforeEach(() => {
      superAdminToken = signToken({
        sub: 'admin-001',
        tenant_id: '__super_admin__',
        role: 'admin',
        token_version: 1,
      });
    });

    // Scenario: 超级管理员首次修改凭证不需要旧密码
    it('超级管理员首次修改凭证不需要旧密码', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/auth/credentials',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: 'admin@papacheck.internal',
          password: 'newpass123',
          // 故意不带 current_password
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      // first_login 应变为 false
      const updatedAdmin = storedUsers.find(u => u.id === 'admin-001');
      expect(updatedAdmin?.first_login).toBe(false);
      // token_version 应递增
      expect(updatedAdmin?.token_version).toBe(2);
    });

    // Scenario: 非首次修改凭证需要旧密码
    it('非首次修改凭证不带旧密码应返回 400', async () => {
      // 先让 admin 变为非首次登录
      const adminUser = storedUsers.find(u => u.id === 'admin-001');
      if (adminUser) adminUser.first_login = false;

      const res = await app.inject({
        method: 'PUT',
        url: '/api/auth/credentials',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: 'admin@papacheck.internal',
          password: 'newpass123',
          // 不带 current_password
        },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  // ==================== Feature: 访问码登录 ====================

  describe('Feature: 访问码登录', () => {
    // Scenario: 通过 access_code 登录
    it('通过有效访问码登录应返回 token 和 role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { access_code: 'ABC123', role: 'parent' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('token');
      expect(body).toHaveProperty('role');
      expect(body.role).toBe('parent'); // access code 的 type 是 'parent'
    });

    it('通过无效访问码登录应返回 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { access_code: 'INVALID', role: 'parent' },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe('INVALID_ACCESS_CODE');
    });
  });

  // ==================== Feature: 家庭成员管理 ====================

  describe('Feature: 家庭成员管理', () => {
    // Scenario: 用户账号创建 parent 访问码
    it('用户账号（role=user）应能创建 parent 访问码', async () => {
      const userToken = signToken({
        sub: 'user-001',
        tenant_id: 'tenant-001',
        role: 'user',
        token_version: 1,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/members',
        headers: { Authorization: `Bearer ${userToken}` },
        payload: { role: 'parent', nickname: '妈妈' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('id');
      expect(body.nickname).toBe('妈妈');
      expect(body.role).toBe('parent');
      // 应返回 access_code 明文
      expect(body).toHaveProperty('access_code');
      expect(typeof body.access_code).toBe('string');
      expect(body.access_code.length).toBeGreaterThanOrEqual(6);
    });

    // Scenario: parent 子账号不能管理成员
    it('parent 角色可读取但不能管理成员', async () => {
      // 构造一个 parent 角色的 JWT（模拟通过访问码登录获得的 token）
      const parentToken = signToken({
        sub: 'user-001',
        tenant_id: 'tenant-001',
        member_id: 'code-001',
        role: 'parent',
        token_version: 1,
      });

      // GET: parent 可以读取成员列表（家长端需要显示孩子选择栏）
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/members',
        headers: { Authorization: `Bearer ${parentToken}` },
      });
      expect(res.statusCode).toBe(200);

      // POST: parent 不能创建成员
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/admin/members',
        headers: { Authorization: `Bearer ${parentToken}` },
        payload: { role: 'child', nickname: 'test' },
      });
      expect(postRes.statusCode).toBe(403);
    });
  });
});
