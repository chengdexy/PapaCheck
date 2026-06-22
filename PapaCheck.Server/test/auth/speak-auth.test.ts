// Feature: GET /api/speak 鉴权改造
//   Scenario: 无 Authorization 头时返回 401
//     Given /api/speak 已从 PUBLIC_PATHS 移除
//     When  不携带 Authorization 头访问 /api/speak
//     Then  返回 401
//
//   Scenario: 携带有效 token 时返回 MP3
//     Given /api/speak 已从 PUBLIC_PATHS 移除
//     When  携带有效 JWT 访问 /api/speak?text=你好
//     Then  返回 200，Content-Type 为 audio/mpeg
//
//   Scenario: 携带无效 token 时返回 401
//     Given /api/speak 已从 PUBLIC_PATHS 移除
//     When  携带非法 token 访问 /api/speak?text=你好
//     Then  返回 401

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';

describe('GET /api/speak 鉴权', () => {
  let app: FastifyInstance;
  let ttsSpeakMock: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // 注册 authMiddleware（与生产环境一致）
    await authMiddleware(app, {
      db: { queryUserTokenVersion: async () => 1 } as any,
    });

    // 注册 /api/speak 路由（mock TTS 返回假 MP3）
    ttsSpeakMock = vi.fn().mockResolvedValue(Buffer.from('fake-mp3'));
    app.get('/api/speak', async (request, reply) => {
      const text = (request.query as { text?: string }).text || '';
      if (!text) {
        return reply.status(400).send({ error: 'Missing text' });
      }
      const mp3Data = await ttsSpeakMock(text);
      if (mp3Data.length === 0) {
        return reply.status(500).send({ error: 'TTS 返回空数据' });
      }
      reply.header('Content-Type', 'audio/mpeg');
      return reply.send(mp3Data);
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('无 token 时返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/speak?text=你好' });
    expect(res.statusCode).toBe(401);
  });

  it('携带无效 token 时返回 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/speak?text=你好',
      headers: { Authorization: 'Bearer invalid-token-here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('携带有效 token 时返回 MP3', async () => {
    const token = signToken({
      sub: 'user-123',
      tenant_id: 'tenant-456',
      role: 'parent',
      token_version: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/speak?text=你好',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(ttsSpeakMock).toHaveBeenCalledWith('你好');
  });
});
