import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const hasDB = !!process.env['DATABASE_URL'];

let app: FastifyInstance;

describe.runIf(hasDB)('Schema Tests', () => {
  beforeAll(async () => {
    app = await buildApp({ port: 0, webDir: '' });
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('统一错误格式', () => {
    it('请求不存在的路由返回 404 统一格式', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code');
    });
  });
});
