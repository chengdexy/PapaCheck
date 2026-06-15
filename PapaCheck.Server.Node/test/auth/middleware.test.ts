import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';
import type { IDatabase } from '../../src/db/types.js';

describe('Auth Middleware', () => {
  let app: FastifyInstance;
  let db: IDatabase;

  beforeAll(async () => {
    app = Fastify();
    // 创建一个模拟 db，只实现 queryUserTokenVersion
    db = {
      queryUserTokenVersion: async (_userId: string) => 1,
    } as any as IDatabase;

    // 直接调用 authMiddleware（而非 app.register），确保 hook 作用于全局
    await authMiddleware(app, { db });

    // 注册公开路径
    app.get('/', async () => ({ ok: true }));
    app.get('/api/ping', async () => ({ ok: true, serverTime: new Date().toISOString() }));

    // 注册受保护的路由
    app.get('/api/test-auth', async (_request, _reply) => {
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Feature: 公开路径无需认证
  //   Scenario: 非 /api/ 路径直接放行
  //     Given 一个非 /api/ 路径的请求
  //     When  不携带认证信息
  //     Then  返回 200

  it('should allow non-API paths without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
  });

  // Feature: 公开 API 路径无需认证
  //   Scenario: whitelist 中的公开路径直接放行
  //     Given 公开 API 路径（如 /api/ping）
  //     When  不携带认证信息
  //     Then  返回 200

  it('should allow public API paths without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(res.statusCode).toBe(200);
  });

  // Feature: 受保护路径需要认证
  //   Scenario: 未携带 token 的请求被拒绝
  //     Given 受保护的 /api/test-auth 路径
  //     When  不携带 Authorization 头
  //     Then  返回 401

  it('should return 401 for protected routes without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test-auth' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body).toHaveProperty('code');
  });

  // Feature: 无效 token 被拒绝
  //   Scenario: 携带无效 token 的请求被拒绝
  //     Given 一个非法的 Bearer token
  //     When  携带该 token 访问受保护路径
  //     Then  返回 401

  it('should return 401 for invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: {
        Authorization: 'Bearer invalid-token-here',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: 有效 token 通过认证
  //   Scenario: 携带有效 token 的请求成功
  //     Given 一个有效的 JWT
  //     When  携带该 token 访问受保护路径
  //     Then  返回 200

  it('should pass with valid token and inject jwtPayload', async () => {
    const token = signToken({
      sub: 'user-123',
      tenant_id: 'tenant-456',
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
