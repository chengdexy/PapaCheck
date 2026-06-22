// Feature: 服务器基础功能
//   Scenario: 启动与心跳
//     Given 服务器尚未启动
//     When 发送 GET /api/ping
//     Then 返回 { ok: true, serverTime: "..." }

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildApp } from '../src/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 测试用的 webDir，指向 PapaCheck.Web 目录 */
const testWebDir = resolve(__dirname, '../../PapaCheck.Web');

const hasDB = !!process.env['DATABASE_URL'];

let app: Awaited<ReturnType<typeof buildApp>>;

describe.runIf(hasDB)('服务器基础功能', () => {
  beforeAll(async () => {
    app = await buildApp({ port: 0, webDir: '' });
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

  describe('GET /api/static-version', () => {
    it('webDir 为空时返回空字符串 version', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/static-version',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('version');
      expect(typeof body.version).toBe('string');
    });
  });

  describe('GET /child', () => {
    it('301 重定向到 /app', async () => {
      const res = await app.inject({ method: 'GET', url: '/child' });
      expect(res.statusCode).toBe(301);
      expect(res.headers.location).toBe('/app');
    });
  });

  describe('GET /parent', () => {
    it('301 重定向到 /app', async () => {
      const res = await app.inject({ method: 'GET', url: '/parent' });
      expect(res.statusCode).toBe(301);
      expect(res.headers.location).toBe('/app');
    });
  });

  describe('GET /app', () => {
    it('无 Authorization 时返回 index.html（状态码 200，Content-Type 含 text/html）', async () => {
      const app2 = await buildApp({ port: 0, webDir: testWebDir });
      const res = await app2.inject({ method: 'GET', url: '/app' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      await app2.close();
    });
  });

  describe('GET /login', () => {
    it('返回 login.html（状态码 200）', async () => {
      const app2 = await buildApp({ port: 0, webDir: testWebDir });
      const res = await app2.inject({ method: 'GET', url: '/login' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      await app2.close();
    });
  });
});
