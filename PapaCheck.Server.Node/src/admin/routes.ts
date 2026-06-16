import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from '../auth/types.js';
import { signToken } from '../auth/jwt.js';
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

const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'family_name'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 6 },
      family_name: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        tenant_id: { type: 'string' },
        admin_hash: { type: 'string' },
        message: { type: 'string' },
      },
    },
    ...errorResponse,
  },
};

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        tenant_id: { type: 'string' },
      },
    },
    ...errorResponse,
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
        access_hash: { type: 'string' },
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
  // POST /api/auth/register — 管理员注册
  app.post('/api/auth/register', { schema: registerSchema }, async (request, reply) => {
    const { email, password, family_name } = request.body as { email: string; password: string; family_name: string };

    // 检查邮箱是否已被注册（含已禁用用户）
    const existingUser = await db.findUserByEmail(email);
    if (existingUser) {
      return reply.status(409).send({ error: '该邮箱已被注册', code: 'EMAIL_EXISTS' });
    }

    // 优先复用已有默认租户（含旧数据），不存在则创建新租户
    const existingTenants = await db.getAllTenants();
    const defaultTenant = existingTenants.find(t => t.name === '默认租户');
    const tenantId = defaultTenant?.id ?? crypto.randomUUID();
    const isNewTenant = !defaultTenant;
    if (defaultTenant) {
      await db.updateTenantName(tenantId, family_name);
    } else {
      await db.createTenant(tenantId, family_name);
    }

    const userId = crypto.randomUUID();
    const { raw, hashed } = await generateAccessHash();
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      await db.createUser({
        id: userId,
        tenant_id: tenantId,
        role: 'parent',
        nickname: email.split('@')[0],
        access_hash: hashed,
        access_code: raw,
        token_version: 1,
        email,
        password_hash: passwordHash,
      });
      await db.updateTenantAdmin(tenantId, userId);
    } catch (e) {
      // 新建租户后用户创建失败，需清理空租户
      if (isNewTenant) {
        await db.deleteTenant(tenantId).catch(() => {});
      }
      throw e;
    }

    return { ok: true, tenant_id: tenantId, admin_hash: raw, message: '注册成功' };
  });

  // POST /api/auth/login — 管理员登录
  app.post('/api/auth/login', { schema: loginSchema, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    const admin = await db.findAdminByEmail(email);
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return reply.status(401).send({ error: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' });
    }

    const token = signToken({
      sub: admin.id,
      tenant_id: admin.tenant_id,
      role: 'parent',
      token_version: admin.token_version,
    });
    return { token, tenant_id: admin.tenant_id };
  });

  // GET /api/admin/members — 成员列表
  app.get('/api/admin/members', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const members = await db.getTenantMembers(payload.tenant_id);
    return members.map(m => ({
      id: m.id,
      nickname: m.nickname,
      role: m.role,
      access_code: m.access_code || null,
      token_version: m.token_version,
      last_login: m.last_login,
      created_at: m.created_at,
    }));
  });

  // POST /api/admin/members — 添加成员
  app.post('/api/admin/members', { schema: addMemberSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { role, nickname } = request.body as { role: 'parent' | 'child'; nickname: string };

    const userId = crypto.randomUUID();
    const { raw, hashed } = await generateAccessHash();
    await db.createUser({
      id: userId,
      tenant_id: payload.tenant_id,
      role,
      nickname,
      access_hash: hashed,
      access_code: raw,
      token_version: 1,
    });

    return { id: userId, nickname, role, access_hash: raw };
  });

  // POST /api/admin/members/:id/regenerate — 重新生成 hash
  app.post('/api/admin/members/:id/regenerate', { schema: { ...memberIdParamSchema, ...regenerateResponseSchema } }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    if (id === payload.sub) {
      return reply.status(400).send({ error: '不能重新生成自己的访问码', code: 'CANNOT_REGENERATE_SELF' });
    }
    const { raw, hashed } = await generateAccessHash();
    await db.regenerateMemberHash(id, payload.tenant_id, hashed, raw);
    return { id, access_code: raw, message: '已重新生成，旧访问码已失效' };
  });

  // DELETE /api/admin/members/:id — 移除成员
  app.delete('/api/admin/members/:id', { schema: { ...memberIdParamSchema, ...deleteMemberResponseSchema } }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    if (id === payload.sub) {
      return reply.status(400).send({ error: '不能移除自己', code: 'CANNOT_DELETE_SELF' });
    }
    await db.deactivateMember(id, payload.tenant_id);
    return { ok: true };
  });
}
