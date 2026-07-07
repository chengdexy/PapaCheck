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
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        child_name: { type: 'string' },
        access_code_id: { type: 'string' },
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
  // GET /api/admin/members — 孩子列表（含访问码）
  app.get('/api/admin/members', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || (payload.role !== 'user' && payload.role !== 'parent')) {
      return reply.status(403).send({ error: '仅用户账号可管理成员', code: 'FORBIDDEN' });
    }

    const children = await db.getChildrenByTenant(payload.sub, false);
    const codes = await db.getAccessCodesByUser(payload.sub);
    const codeByChildId = new Map<string, typeof codes[0]>();
    for (const c of codes) {
      codeByChildId.set(c.child_id, c);
    }

    return children.map(ch => {
      const code = codeByChildId.get(ch.id);
      return {
        child_id: ch.id,
        child_name: ch.name || '(未命名)',
        is_active: ch.is_active,
        access_code_id: code?.id ?? null,
        access_code: code?.access_code ?? null,
        last_login: code?.last_login ?? null,
        created_at: code?.created_at ?? ch.created_at,
      };
    });
  });

  // POST /api/admin/members — 创建孩子 + 访问码
  app.post('/api/admin/members', { schema: addMemberSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'user') {
      return reply.status(403).send({ error: '仅用户账号可管理成员', code: 'FORBIDDEN' });
    }

    const { name } = request.body as { name: string };

    const accessCodeId = crypto.randomUUID();
    const { raw, hashed } = await generateAccessHash();

    // 先创建孩子（createChild 内部生成自己的 id）
    const child = await db.createChild(payload.sub, name, accessCodeId);

    // 再创建关联的访问码，使用孩子的真实 id
    await db.createAccessCode({
      id: accessCodeId,
      tenant_id: payload.sub,
      code_hash: hashed,
      access_code: raw,
      child_id: child.id,
    });

    return { child_id: child.id, child_name: name, access_code_id: accessCodeId, access_code: raw };
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

    // 清理 children 表中的 access_code_id 引用（不删除 children 记录）
    const child = await db.findChildByAccessCodeId(id, payload.sub);
    if (child) {
      await db.updateChild(child.id, payload.sub, { access_code_id: null });
    }

    await db.deleteAccessCode(id, payload.sub);
    return { ok: true };
  });
}
