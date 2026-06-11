// Feature: 邮件同步
//   Scenario: 需要邮箱配置才能同步
//     Given 未保存邮箱配置
//     When 触发邮件同步
//     Then 返回错误「请先配置邮箱」
//
//   Scenario: 连接 IMAP 服务器读取未读邮件
//     Given 已保存有效的邮箱配置
//     When 触发邮件同步
//     Then 连接 IMAP 服务器获取未读邮件
//
//   Scenario: 调用 AI API 解析邮件内容
//     Given 已获取到未读邮件内容
//     When 调用 AI API 解析
//     Then 返回解析后的作业项
//
//   Scenario: 同步失败时返回错误信息
//     Given 邮箱配置有效但 IMAP 连接失败
//     When 触发邮件同步
//     Then 返回连接失败的错误信息

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

// Shared flag to control IMAP connect behavior
let imapShouldFail = false;
let openBoxShouldFail = false;

// Mock imap module with proper EventEmitter-based event handling
vi.mock('imap', () => {
  const MockIMAP = vi.fn().mockImplementation(function () {
    const readyHandlers: Function[] = [];
    const errorHandlers: Function[] = [];

    const api = {
      once: vi.fn((event: string, cb: Function) => {
        if (event === 'ready') readyHandlers.push(cb);
        if (event === 'error') errorHandlers.push(cb);
      }),
      on: vi.fn(),
      connect: vi.fn(() => {
        setTimeout(() => {
          if (imapShouldFail) {
            errorHandlers.forEach((cb) => cb(new Error('IMAP connection failed')));
          } else {
            readyHandlers.forEach((cb) => cb());
          }
        }, 5);
      }),
      openBox: vi.fn((_name: string, _readOnly: boolean, cb: Function) => {
        if (openBoxShouldFail) {
          cb(new Error('Cannot open mailbox'));
        } else {
          cb(null);
        }
      }),
      search: vi.fn((_criteria: string[], cb: Function) => {
        cb(null, [1, 2, 3]);
      }),
      fetch: vi.fn((_uids: number[], _opts: any) => {
        const fetchEmitter = new EventEmitter();

        // Simulate each message being emitted
        const emailBodies = [
          'From: teacher@school.com\r\nSubject: 本周作业\r\nDate: 2026-06-06T10:00:00Z\r\n\r\n数学：完成练习册第10页',
          'From: teacher@school.com\r\nSubject: 语文作业\r\nDate: 2026-06-06T11:00:00Z\r\n\r\n语文：背诵古诗三首',
          'From: teacher@school.com\r\nSubject: 英语作业\r\nDate: 2026-06-06T12:00:00Z\r\n\r\n英语：朗读课文第5课',
        ];

        setTimeout(() => {
          emailBodies.forEach((body, index) => {
            const uid = index + 1;
            const msgEmitter = new EventEmitter();

            // Emit 'attributes' with uid
            setTimeout(() => {
              msgEmitter.emit('attributes', { uid });

              // Emit 'body' with a readable stream containing email data
              const { Readable } = require('stream');
              const stream = new Readable();
              stream.push(Buffer.from(body));
              stream.push(null);
              msgEmitter.emit('body', stream, { which: '', size: body.length });

              // Emit 'end' after body
              setTimeout(() => {
                msgEmitter.emit('end');
              }, 2);
            }, 2);

            fetchEmitter.emit('message', msgEmitter, uid);
          });

          // Emit fetch 'end' after all messages
          setTimeout(() => {
            fetchEmitter.emit('end');
          }, emailBodies.length * 5 + 10);
        }, 5);

        return fetchEmitter;
      }),
      end: vi.fn(),
      addFlags: vi.fn((_uids: number[], _flags: string, cb: Function) => cb()),
    };
    return api;
  });

  return { default: MockIMAP as any };
});

// Mock fetch for AI API calls
vi.stubGlobal('fetch', vi.fn());

describe('EmailSync', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    imapShouldFail = false;
    openBoxShouldFail = false;
    app = await buildApp({ port: 0, webDir: '', dbPath: ':memory:', showPollingLog: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/email/config - 保存邮箱配置', () => {
    it('保存邮箱配置到数据库', async () => {
      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('ok', true);
    });

    it('配置缺少必填字段时返回 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: { host: 'imap.example.com' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/email/sync - 触发邮件同步', () => {
    it('未配置邮箱时返回错误', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error');
    });

    it('配置有效时连接 IMAP 并获取邮件', async () => {
      // Mock fetch to return AI parsed result (empty - no homework found)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '[]' } }],
        }),
      });
      (globalThis as any).fetch = mockFetch;

      // 先保存配置
      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      // 触发同步
      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('hasAttachments', false);
    });

    it('同步返回解析出的作业', async () => {
      // Mock fetch to return AI parsed result
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { subject: '数学', content: '完成练习册第10页', date: '2026-06-06' },
                  { subject: '语文', content: '背诵古诗三首', date: '2026-06-06' },
                ]),
              },
            },
          ],
        }),
      });
      (globalThis as any).fetch = mockFetch;

      // 先保存配置
      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      // 触发同步
      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('homeworks');
      expect(Array.isArray(body.homeworks)).toBe(true);
      expect(body.homeworks.length).toBeGreaterThanOrEqual(1);
      expect(body).toHaveProperty('hasAttachments', false);
    });

    it('IMAP 连接失败时返回错误信息', async () => {
      // 设置 IMAP 连接失败标志
      imapShouldFail = true;

      // 先保存配置
      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'wrong-password',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      // 触发同步（mock 会触发 error 事件）
      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code', 'EMAIL_SYNC_ERROR');
    });

    it('IMAP openBox 失败时返回错误信息', async () => {
      openBoxShouldFail = true;

      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code', 'EMAIL_SYNC_ERROR');
    });

    it('AI API 超时时返回超时错误信息', async () => {
      // Mock fetch to reject with AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(abortError);
      (globalThis as any).fetch = mockFetch;

      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error', 'AI API 请求超时（30秒）');
      expect(body).toHaveProperty('code', 'EMAIL_SYNC_ERROR');
    });

    it('AI API 返回非 200 状态码时返回错误', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });
      (globalThis as any).fetch = mockFetch;

      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-invalid',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('AI API 调用失败');
      expect(body).toHaveProperty('code', 'EMAIL_SYNC_ERROR');
    });

    it('AI API 返回空 choices 时返回错误', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });
      (globalThis as any).fetch = mockFetch;

      const config = {
        host: 'imap.example.com',
        port: 993,
        user: 'test@example.com',
        password: 'password123',
        apiKey: 'sk-xxx',
        apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      };

      await app.inject({
        method: 'POST',
        url: '/api/email/config',
        payload: config,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/email/sync',
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty('error', 'AI API 返回空结果');
      expect(body).toHaveProperty('code', 'EMAIL_SYNC_ERROR');
    });
  });
});
