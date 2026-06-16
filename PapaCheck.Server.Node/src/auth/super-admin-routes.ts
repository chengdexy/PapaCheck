import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from './types.js';
import bcrypt from 'bcryptjs';

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

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'current_password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 6 },
      current_password: { type: 'string', minLength: 1 },
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

const tenantToggleSchema = {
  body: {
    type: 'object',
    required: ['is_active'],
    properties: {
      is_active: { type: 'boolean' },
    },
  },
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

export async function superAdminRoutes(app: FastifyInstance, db: IDatabase): Promise<void> {
  // PUT /api/admin/super/credentials — 修改超级管理员凭证
  app.put('/api/admin/super/credentials', { schema: credentialsSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'admin') {
      return reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { email: newEmail, password: newPassword, current_password } = request.body as { email: string; password: string; current_password: string };

    // Verify current password
    const user = await db.getUserById(payload.sub);
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return reply.status(401).send({ error: '当前密码错误', code: 'INVALID_CREDENTIALS' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.updateUserCredentials(payload.sub, newEmail, passwordHash);
    return { ok: true, message: '凭证已更新' };
  });

  // GET /api/admin/super/tenants — 所有家庭列表
  app.get('/api/admin/super/tenants', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'admin') {
      return reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const tenants = await db.getAllTenants();
    return tenants;
  });

  // PATCH /api/admin/super/tenants/:id — 启用/禁用家庭
  app.patch('/api/admin/super/tenants/:id', { schema: tenantToggleSchema }, async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'admin') {
      return reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    const { is_active } = request.body as { is_active: boolean };

    // 通过 pool 直接更新
    const pool = (db as any).pool;
    if (pool) {
      await pool.query('UPDATE users SET is_active = $1 WHERE id = $2 AND role = $3', [is_active, id, 'user']);
    }
    return { ok: true };
  });
}
