import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import type { IDatabase } from './db/types.js';

const PUBLIC_PATHS = new Set([
  '/api/ping',
  '/api/version',
  '/api/static-version',
  '/api/download',
  '/api/login',
  '/api/logout',
]);

const SESSION_COOKIE = 'papacheck_session';

// 简单的内存 session 存储（临时方案，Phase 5c 将替换为 JWT）
const sessions = new Set<string>();

export async function authPlugin(app: FastifyInstance, db: IDatabase): Promise<void> {
  // 自动生成密码（如果 settings 中没有）
  let settings = await await db.getSettings();
  if (!settings?.apiPassword) {
    const password = 'papacheck-' + crypto.randomBytes(4).toString('hex');
    settings = { ...settings, apiPassword: password };
    await await db.saveSettings(settings);
    console.log('========================================');
    console.log(`🔑 临时访问密码 (请保存): ${password}`);
    console.log('========================================');
  }

  // 认证钩子（仅保护 /api/* 端点，静态页面放行）
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split('?')[0];
    
    // 仅拦截 /api/ 路径
    if (!url.startsWith('/api/')) return;
    
    // 公开 API 路径放行
    if (PUBLIC_PATHS.has(url)) return;
    
    // 检查 OPTIONS 预检请求（CORS）
    if (request.method === 'OPTIONS') return;

    // 检查 session cookie
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (sessionId && sessions.has(sessionId)) {
      return; // 已认证
    }

    return reply.status(401).send({ error: '未授权，请先登录', code: 'UNAUTHORIZED' });
  });

  // 登录端点
  app.post('/api/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { password } = request.body as { password: string };
    const currentSettings = await await db.getSettings();
    if (password === currentSettings?.apiPassword) {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      sessions.add(sessionToken);
      
      reply.setCookie(SESSION_COOKIE, sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 天
      });
      return { ok: true };
    }
    return reply.status(401).send({ error: '密码错误', code: 'UNAUTHORIZED' });
  });

  // 登出端点
  app.post('/api/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
