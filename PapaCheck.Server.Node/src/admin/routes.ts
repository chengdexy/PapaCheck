import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from '../auth/types.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const errorResponse = {
  400: {
    type: 'object',
    properties: { error: { type: 'string' }, code: { type: 'string' } },
  },
  401: {
    type: 'object',
    properties: { error: { type: 'string' }, code: { type: 'string' } },
  },
  403: {
    type: 'object',
    properties: { error: { type: 'string' }, code: { type: 'string' } },
  },
};

const addMemberSchema = {
  body: {
    type: 'object',
    required: ['role', 'nickname'],
    properties: {
      role: { type: 'string', enum: ['parent', 'child'] },
      nickname: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nickname: { type: 'string' },
        role: { type: 'string' },
        access_code: { type: 'string' },
      },
    },
    ...errorResponse,
  },
};

const memberIdParamSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
  },
};

const regenerateResponseSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        access_code: { type: 'string' },
        message: { type: 'string' },
      },
    },
    ...errorResponse,
  },
};

const deleteMemberResponseSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
    },
    ...errorResponse,
  },
};

async function generateAccessHash(): Promise<{ raw: string; hashed: string }> {
  // 6位字母数字码，排除易混淆字符 0/O/1/I/l
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let raw = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  const hashed = await bcrypt.hash(raw, 10);
  return { raw, hashed };
}

export async function adminRoutes(app: FastifyInstance, db: IDatabase): Promise<void> {
  // GET /api/admin/members — 访问码列表（仅 user 角色可访问）
  app.get('/api/admin/members', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'user') {
      return reply.status(403).send({ error: '仅用户账号可管理成员', code: 'FORBIDDEN' });
    }

    const codes = await db.getAccessCodesByUser(payload.sub);
    return codes.map(c => ({
      id: c.id,
      nickname: c.nickname,
      role: c.type,
      access_code: c.access_code ?? null,
      last_login: c.last_login ?? null,
      created_at: c.created_at,
    }));
  });

  // POST /api/admin/members — 创建访问码
  app.post('/api/admin/members', { schema: addMemberSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'user') {
      return reply.status(403).send({ error: '仅用户账号可管理成员', code: 'FORBIDDEN' });
    }

    const { role, nickname } = request.body as { role: 'parent' | 'child'; nickname: string };

    const id = crypto.randomUUID();
    const { raw, hashed } = await generateAccessHash();
    await db.createAccessCode({ id, user_id: payload.sub, type: role, code_hash: hashed, nickname });

    return { id, nickname, role, access_code: raw };
  });

  // POST /api/admin/members/:id/regenerate — 重新生成访问码
  app.post('/api/admin/members/:id/regenerate', { schema: { ...memberIdParamSchema, ...regenerateResponseSchema }, config: { rateLimit: false } }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'user') {
      return reply.status(403).send({ error: '仅用户账号可管理成员', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    const raw = await db.regenerateAccessCode(id, payload.sub);
    return { id, access_code: raw, message: '已重新生成，旧访问码已失效' };
  });

  // DELETE /api/admin/members/:id — 删除访问码
  app.delete('/api/admin/members/:id', { schema: { ...memberIdParamSchema, ...deleteMemberResponseSchema } }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'user') {
      return reply.status(403).send({ error: '仅用户账号可管理成员', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    await db.deleteAccessCode(id, payload.sub);
    return { ok: true };
  });
}
