import { describe, it, expect, test, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../../src/auth/routes.js';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';
import type { IDatabase, UserRecord } from '../../src/db/types.js';
import { buildApp } from '../../src/app.js';

describe('Auth Routes', () => {
  let app: FastifyInstance;

  // 创建一个模拟 DB
  const mockUser: UserRecord = {
    id: 'test-user-1',
    tenant_id: 'test-tenant-1',
    role: 'parent',
    nickname: '测试家长',
    access_hash: '$2a$10$dummy',
    token_version: 1,
    is_active: true,
    created_at: '2024-01-01T00:00:00.000Z',
    last_login: undefined,
  };

  const mockDb: IDatabase = {
    queryUserTokenVersion: async (_userId: string) => 1,
    findUserByAccessHash: async (accessHash: string) => {
      // 模拟：仅当 access_code 为 'valid-code-123' 时返回用户（兼容旧格式）
      if (accessHash === 'valid-code-123') {
        return { ...mockUser };
      }
      return null;
    },
    findUserByAccessCode: async () => null,
    getUserById: async (userId: string) => {
      if (userId === mockUser.id) {
        return { ...mockUser };
      }
      return null;
    },
    updateUserLastLogin: async (_userId: string) => {
      // no-op
    },
    // 以下为 IDatabase 其他方法的桩实现
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
  };

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

    // 先注册 authMiddleware（注入 jwtPayload）
    await authMiddleware(app, { db: mockDb });

    // 再注册 auth 路由
    await authRoutes(app, mockDb);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Feature: POST /api/auth/exchange
  //   Scenario: 缺少 access_code
  //     Given 一个没有 access_code 的请求体
  //     When  调用 POST /api/auth/exchange
  //     Then  返回 400 错误

  it('should return 400 when access_code is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/exchange',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // Feature: POST /api/auth/exchange
  //   Scenario: access_code 长度不足
  //     Given 一个 length 小于 8 的 access_code
  //     When  调用 POST /api/auth/exchange
  //     Then  返回 400 错误

  it('should return 400 when access_code is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/exchange',
      payload: { access_code: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  // Feature: POST /api/auth/exchange
  //   Scenario: 无效的 access_code
  //     Given 一个无效的 access_code
  //     When  调用 POST /api/auth/exchange
  //     Then  返回 401 错误

  it('should return 401 when access_code is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/exchange',
      payload: { access_code: 'invalid-code-xxx' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('INVALID_ACCESS_CODE');
  });

  // Feature: POST /api/auth/exchange
  //   Scenario: 有效的 access_code 换取 JWT
  //     Given 一个有效的 access_code
  //     When  调用 POST /api/auth/exchange
  //     Then  返回 200 并包含 token、role、nickname

  it('should return token when access_code is valid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/exchange',
      payload: { access_code: 'valid-code-123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('token');
    expect(body.role).toBe('parent');
    expect(body.nickname).toBe('测试家长');
  });

  // Feature: GET /api/auth/me
  //   Scenario: 未携带 token 访问
  //     Given 未携带 Authorization 头
  //     When  调用 GET /api/auth/me
  //     Then  返回 401 错误

  it('should return 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: GET /api/auth/me
  //   Scenario: 携带有效 token 返回用户信息
  //     Given 一个有效的 JWT token
  //     When  调用 GET /api/auth/me
  //     Then  返回 200 并包含用户信息

  it('should return user info with valid token', async () => {
    const token = signToken({
      sub: mockUser.id,
      tenant_id: mockUser.tenant_id,
      role: mockUser.role,
      token_version: mockUser.token_version,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(mockUser.id);
    expect(body.nickname).toBe(mockUser.nickname);
    expect(body.role).toBe(mockUser.role);
    expect(body.tenant_id).toBe(mockUser.tenant_id);
  });
});

// ==================== 速率限制测试 ====================

test('POST /api/auth/exchange 超出速率限制应返回 429', async () => {
  const app = await buildApp({ port: 0, webDir: '', dbPath: ':memory:', enableAuth: true });
  // 连续发送 11 次请求，第 11 次应返回 429
  for (let i = 0; i < 10; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/exchange',
      payload: { access_code: 'invalid-code' },
    });
    // 前 10 次不应限流（可能返回 400 或 401，但不能是 429）
    expect(res.statusCode).not.toBe(429);
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/exchange',
    payload: { access_code: 'invalid-code' },
  });
  expect(res.statusCode).toBe(429);
  const body = JSON.parse(res.body);
  expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
  await app.close();
});
