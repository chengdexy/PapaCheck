// 集成测试需要 DATABASE_URL 环境变量指向可用的 PostgreSQL 实例。
// buildApp 启动时会调用 createDatabase({}) 初始化连接池，无 DATABASE_URL 将抛错。
// 本地运行：先执行 scripts/setup-test-db.ps1 搭建测试库并生成 .env.test，
// 或手动设置 DATABASE_URL=postgresql://user:pass@localhost:5432/papacheck_test
// 无 DATABASE_URL 时本测试套件自动跳过，不影响 scf-handler 单元测试。
import { describe, it, expect } from 'vitest';
import { main } from '../index.js';
import type { ScfEvent } from '../scf-handler.js';

function makeEvent(overrides: Partial<ScfEvent> = {}): ScfEvent {
  return {
    httpMethod: 'GET',
    path: '/api/ping',
    headers: {},
    queryStringParameters: null,
    body: null,
    ...overrides,
  };
}

describe.skipIf(!process.env.DATABASE_URL)('云函数端到端集成', () => {
  it('GET /api/ping 返回 200', async () => {
    const result = await main(makeEvent({ path: '/api/ping' }));
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.serverTime).toBeDefined();
  });

  it('GET /api/version 返回 clientVersion', async () => {
    process.env.APK_VERSION = '1.5.2';
    const result = await main(makeEvent({ path: '/api/version' }));
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.clientVersion).toBe('1.5.2');
  });

  it('GET /api/download 返回 302 重定向', async () => {
    process.env.APK_VERSION = '1.5.2';
    const result = await main(makeEvent({ path: '/api/download' }));
    expect(result.statusCode).toBe(302);
    expect(result.headers.location).toContain('tcb.qcloud.la');
  });

  it('GET /api/data 无 Authorization 返回 401', async () => {
    const result = await main(makeEvent({ path: '/api/data' }));
    expect(result.statusCode).toBe(401);
  });

  it('未知路由返回 404', async () => {
    const result = await main(makeEvent({ path: '/api/nonexistent' }));
    expect(result.statusCode).toBe(404);
  });
});
