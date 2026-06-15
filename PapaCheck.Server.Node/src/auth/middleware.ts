import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from './types.js';
import { verifyToken } from './jwt.js';

const PUBLIC_PATHS = new Set([
  '/api/ping',
  '/api/version',
  '/api/static-version',
  '/api/download',
  '/api/speak',
  '/api/auth/exchange',
  '/api/auth/register',
  '/api/auth/login',
  '/api/admin/super/login',
]);

export async function authMiddleware(app: FastifyInstance, opts: { db: IDatabase }): Promise<void> {
  const { db } = opts;

  app.decorateRequest('jwtPayload', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url.split('?')[0];

    // 仅拦截 /api/ 路径
    if (!url.startsWith('/api/')) return;

    // 公开 API 路径放行
    if (PUBLIC_PATHS.has(url)) return;

    // 检查 OPTIONS 预检请求（CORS）
    if (request.method === 'OPTIONS') return;

    // 检查 Authorization header
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: '缺少认证信息', code: 'MISSING_AUTH' });
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (!payload) {
      return reply.status(401).send({ error: '无效的认证令牌', code: 'INVALID_TOKEN' });
    }

    // 检查 token_version 是否匹配（token 是否被吊销）
    try {
      const currentTokenVersion = await db.queryUserTokenVersion(payload.sub);
      if (payload.token_version < currentTokenVersion) {
        return reply.status(401).send({ error: '认证已过期，请重新登录', code: 'SESSION_EXPIRED' });
      }
    } catch {
      // 数据库查询失败时放行（兼容无 users 表的旧数据库）
    }

    // 注入 payload
    (request as any).jwtPayload = payload;
  });
}
