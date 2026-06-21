import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from './types.js';
import { signToken } from './jwt.js';
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
  404: {
    type: 'object',
    properties: { error: { type: 'string' }, code: { type: 'string' } },
  },
};

const exchangeSchema = {
  body: {
    type: 'object',
    required: ['access_code'],
    properties: {
      access_code: { type: 'string', minLength: 6 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        role: { type: 'string' },
        nickname: { type: 'string' },
      },
    },
    ...errorResponse,
  },
};

const meSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nickname: { type: 'string' },
        role: { type: 'string' },
        tenant_id: { type: 'string' },
        email: { type: 'string' },
        family_name: { type: 'string' },
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
      password: { type: 'string', minLength: 6 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        role: { type: 'string' },
        family_name: { type: 'string' },
        needs_password_change: { type: 'boolean' },
      },
    },
    ...errorResponse,
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
        token: { type: 'string' },
        role: { type: 'string' },
        family_name: { type: 'string' },
      },
    },
    ...errorResponse,
  },
};

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['password'],
    properties: {
      email: { type: 'string' },
      password: { type: 'string', minLength: 6 },
      current_password: { type: 'string' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
    ...errorResponse,
  },
};

export async function authRoutes(app: FastifyInstance, db: IDatabase): Promise<void> {
  // POST /api/auth/exchange — 访问码换取JWT
  app.post('/api/auth/exchange', { schema: exchangeSchema, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { access_code } = request.body as { access_code: string };

    const record = await db.findAccessCodeByCode(access_code);
    if (!record) {
      return reply.status(401).send({ error: '访问码无效', code: 'INVALID_ACCESS_CODE' });
    }

    // 孩子角色：查找或创建 children 记录
    let childId: string | undefined;
    if (record.type === 'child') {
      let child = await db.findChildByAccessCodeId(record.id, record.user_id);
      if (!child) {
        // 自动创建 children 记录（兼容迁移遗漏）
        child = await db.createChild(record.user_id, record.nickname, record.id);
      }
      if (!child.is_active) {
        return reply.status(403).send({ error: '孩子已被禁用', code: 'CHILD_DISABLED' });
      }
      childId = child.id;
    }

    // 记录最后登录时间
    await db.updateAccessCodeLastLogin(record.id).catch(() => {});

    const token = signToken({
      sub: record.user_id,
      tenant_id: record.user_id,
      member_id: record.id,
      child_id: childId,
      role: record.type,
      token_version: record.token_version,
    });
    const response: any = { token, role: record.type, nickname: record.nickname };
    if (record.type === 'child' || record.type === 'parent') {
      response.needs_setup = true;
    }
    if (childId) {
      response.child_id = childId;
    }
    return response;
  });

  // POST /api/auth/login — 统一登录（admin + user）
  app.post('/api/auth/login', { schema: loginSchema, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    const user = await db.findUserByEmail(email);
    if (!user || !user.password_hash) {
      return reply.status(401).send({ error: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return reply.status(401).send({ error: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' });
    }

    if (user.role !== 'admin' && user.role !== 'user') {
      return reply.status(403).send({ error: '请使用访问码登录', code: 'USE_ACCESS_CODE' });
    }

    const token = signToken({
      sub: user.id,
      tenant_id: user.id,
      role: user.role,
      token_version: user.token_version,
    });

    const response: any = { token, role: user.role };
    if (user.role === 'admin') {
      response.needs_password_change = !!user.first_login;
    }
    if (user.role === 'user') {
      response.family_name = user.family_name;
    }
    return response;
  });

  // POST /api/auth/register — 注册用户账号（role='user'）
  app.post('/api/auth/register', { schema: registerSchema, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password, family_name } = request.body as { email: string; password: string; family_name: string };

    const existing = await db.findUserByEmail(email);
    if (existing) {
      return reply.status(409).send({ error: '该邮箱已被注册', code: 'EMAIL_EXISTS' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.createUser({
      id: userId,
      role: 'user',
      email,
      password_hash: passwordHash,
      family_name: family_name,
      tenant_id: userId,
      token_version: 1,
    });

    // Create tenant record
    await db.createTenant(userId, family_name);

    const token = signToken({
      sub: userId,
      tenant_id: userId,
      role: 'user',
      token_version: 1,
    });

    return { token, role: 'user', family_name };
  });

  // PUT /api/auth/credentials — 修改凭证（admin/user 通用）
  app.put('/api/auth/credentials', { schema: credentialsSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload) {
      return reply.status(401).send({ error: '未授权', code: 'UNAUTHORIZED' });
    }

    const user = await db.getUserById(payload.sub);
    if (!user) {
      return reply.status(404).send({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    }

    const { email: newEmail, password: newPassword, current_password } = request.body as { email?: string; password: string; current_password?: string };

    // 首次登录：不需要 current_password
    if (!user.first_login) {
      if (!current_password || !bcrypt.compareSync(current_password, user.password_hash!)) {
        return reply.status(401).send({ error: '当前密码错误', code: 'INVALID_CREDENTIALS' });
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.updateUserCredentials(payload.sub, newEmail ?? user.email!, passwordHash);

    return { ok: true, message: '凭证已更新' };
  });

  // GET /api/auth/me — 当前用户信息
  app.get('/api/auth/me', { schema: meSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload) {
      return reply.status(401).send({ error: '未授权', code: 'UNAUTHORIZED' });
    }

    // admin/user 从 users 表查询（通过 ID）
    if (payload.role === 'admin' || payload.role === 'user') {
      const user = await db.getUserById(payload.sub);
      if (!user) {
        return reply.status(404).send({ error: '用户不存在', code: 'USER_NOT_FOUND' });
      }
      return {
        id: user.id,
        role: user.role,
        email: user.email,
        family_name: user.family_name,
      };
    }

    // parent/child 从 access_codes 表查询
    const record = await db.getAccessCodeById(payload.member_id ?? payload.sub);
    if (!record) {
      return reply.status(404).send({ error: '访问码不存在', code: 'NOT_FOUND' });
    }
    return {
      id: record.id,
      nickname: record.nickname,
      role: record.type,
    };
  });
}
