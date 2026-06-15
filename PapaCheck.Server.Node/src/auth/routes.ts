import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from './types.js';
import { signToken } from './jwt.js';

export async function authRoutes(app: FastifyInstance, db: IDatabase): Promise<void> {
  // POST /api/auth/exchange — hash码换取JWT
  app.post('/api/auth/exchange', async (request, reply) => {
    const { access_code } = request.body as any;
    if (!access_code || access_code.length < 8) {
      return reply.status(400).send({ error: '无效的访问码', code: 'INVALID_ACCESS_CODE' });
    }
    const user = await db.findUserByAccessHash(access_code);
    if (!user) {
      return reply.status(401).send({ error: '访问码无效', code: 'INVALID_ACCESS_CODE' });
    }
    if (!user.is_active) {
      return reply.status(401).send({ error: '该账号已被停用', code: 'USER_DISABLED' });
    }
    await db.updateUserLastLogin(user.id);
    const token = signToken({
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      token_version: user.token_version,
    });
    return { token, role: user.role, nickname: user.nickname };
  });

  // GET /api/auth/me — 当前用户信息
  app.get('/api/auth/me', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload) {
      return reply.status(401).send({ error: '未授权', code: 'UNAUTHORIZED' });
    }
    const user = await db.getUserById(payload.sub);
    if (!user) {
      return reply.status(404).send({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    }
    return {
      id: user.id,
      nickname: user.nickname,
      role: user.role,
      tenant_id: user.tenant_id,
    };
  });
}
