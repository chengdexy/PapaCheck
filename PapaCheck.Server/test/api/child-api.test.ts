/**
 * child-api.test.ts - 孩子 API 隔离集成测试
 *
 * Feature: 孩子 API 隔离
 *   Scenario: 孩子角色只能看到自己的数据
 *   Scenario: 家长角色通过 child_id 查询指定孩子
 *   Scenario: 家长角色缺少 child_id 参数 → 400
 *   Scenario: 家长不能查询其他家庭的孩子 → 403
 *   Scenario: 旧 JWT 兼容
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const hasDB = !!process.env['DATABASE_URL'];

describe.runIf(hasDB)('Child API Isolation (孩子 API 隔离)', () => {
  let app: any;
  let db: any;
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01';
  let childA: string;
  let childB: string;
  let foreignChild: string;
  let _testJwt: any = null;

  beforeAll(async () => {
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ port: 0, webDir: '', showPollingLog: false, rateLimit: false });

    app.addHook('onRequest', async (request: any) => {
      if (_testJwt) request.jwtPayload = { ..._testJwt };
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    db = (app as any).papaCheckDB;

    // Setup tenants
    await db.pool.query("INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '家庭A', $1, '家长A') ON CONFLICT (id) DO NOTHING", [tenantA]);
    await db.pool.query("INSERT INTO tenants (id, name) VALUES ($1, '家庭A') ON CONFLICT (id) DO NOTHING", [tenantA]);
    await db.pool.query("INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '家庭B', $1, '家长B') ON CONFLICT (id) DO NOTHING", [tenantB]);
    await db.pool.query("INSERT INTO tenants (id, name) VALUES ($1, '家庭B') ON CONFLICT (id) DO NOTHING", [tenantB]);

    childA = '11111111-1111-1111-1111-1111111111a1';
    childB = '22222222-2222-2222-2222-2222222222b1';
    await db.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小明') ON CONFLICT (id) DO NOTHING", [childA, tenantA]);
    await db.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小红') ON CONFLICT (id) DO NOTHING", [childB, tenantA]);
    await db.pool.query("INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 0) ON CONFLICT (tenant_id, child_id, id) DO NOTHING", [tenantA, childA]);
    await db.pool.query("INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 0) ON CONFLICT (tenant_id, child_id, id) DO NOTHING", [tenantA, childB]);

    foreignChild = '33333333-3333-3333-3333-3333333333f1';
    await db.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '外人') ON CONFLICT (id) DO NOTHING", [foreignChild, tenantB]);
  });

  afterAll(async () => {
    _testJwt = null;
    if (app) await app.close();
  });

  it('孩子角色只能看到自己的数据', async () => {
    const dateKey = '2026-06-21';
    await db.pool.query("INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4", [tenantA, childA, dateKey, JSON.stringify([{ id: 'hwA', subject: '数学' }])]);
    await db.pool.query("INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4", [tenantA, childB, dateKey, JSON.stringify([{ id: 'hwB', subject: '语文' }])]);

    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'child', child_id: childA, token_version: 1 };

    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.homeworks[dateKey]?.[0]?.subject).toBe('数学');
    const hwSubjects = (body.homeworks[dateKey] || []).map((h: any) => h.subject);
    expect(hwSubjects).not.toContain('语文');
  });

  it('家长角色通过 child_id 查询指定孩子', async () => {
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'parent', child_id: childA, token_version: 1 };

    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.homeworks['2026-06-21']?.[0]?.subject).toBe('数学');
  });

  it('家长缺 child_id 时返回 400 错误', async () => {
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'parent', token_version: 1 };

    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('MISSING_CHILD_ID');
  });

  it('家长不能查询其他家庭的孩子', async () => {
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'parent', child_id: foreignChild, token_version: 1 };

    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FOREIGN_CHILD');
  });

  it('child 角色 JWT 不含 child_id 时返回 400', async () => {
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'child', token_version: 1 };

    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('MISSING_CHILD_ID');
  });

  it('admin 角色不受 child_id 限制', async () => {
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'admin', token_version: 1 };

    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/data-version 返回租户级版本戳，无需 child_id', async () => {
    // 家长角色即使不带 child_id 也能拿到版本戳（版本戳是租户级）
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'parent', token_version: 1 };

    // 先写入一条修改，确保有版本戳
    await db.recordModification('homeworks', '2026-06-30', new Date().toISOString(), tenantA);

    const res = await app.inject({ method: 'GET', url: '/api/data-version' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('version');
    expect(typeof body.version).toBe('string');
  });

  it('GET /api/data-version 在数据变更后版本戳发生变化', async () => {
    _testJwt = { tenant_id: tenantA, sub: tenantA, role: 'parent', token_version: 1 };

    const before = JSON.parse((await app.inject({ method: 'GET', url: '/api/data-version' })).body).version;

    // 触发一次新的数据变更
    await db.recordModification('homeworks', '2026-07-01', new Date(Date.now() + 2000).toISOString(), tenantA);

    const after = JSON.parse((await app.inject({ method: 'GET', url: '/api/data-version' })).body).version;
    expect(after).not.toBe(before);
  });
});
