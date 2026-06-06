// Feature: 服务器基础功能
//   Scenario: 启动与心跳
//     Given 服务器尚未启动
//     When 发送 GET /api/ping
//     Then 返回 { ok: true, serverTime: "..." }

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ port: 0, webDir: '', dbPath: ':memory:' });
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/ping', () => {
  it('返回 ok: true 和 serverTime', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ping',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('serverTime');
    expect(typeof body.serverTime).toBe('string');
  });
});
