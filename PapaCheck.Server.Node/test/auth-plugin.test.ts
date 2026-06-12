import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createDatabase } from '../src/db/index.js';

describe('Auth Plugin', () => {
  const app = Fastify();
  let db: any;

  beforeAll(async () => {
    db = createDatabase({ dbPath: ':memory:' });
    // 手动设置一个已知密码用于测试
    db.saveSettings({ apiPassword: 'test-password' });

    // 必须先注册 cookie 解析器，auth 插件才能使用 cookies
    await app.register(cookie);

    // 注册 auth 插件
    const { authPlugin } = await import('../src/auth-plugin.js');
    await authPlugin(app, db);

    // 添加测试路由
    app.get('/api/test-auth', async () => ({ ok: true }));
    // 添加公开路径 /api/ping 用于测试
    app.get('/api/ping', async () => ({ ok: true, serverTime: new Date().toISOString() }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it('should return 401 for unauthenticated /api/* requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test-auth' });
    expect(res.statusCode).toBe(401);
  });

  it('should allow login with correct password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'test-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('should reject login with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should allow public paths without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(res.statusCode).toBe(200);
  });
});
