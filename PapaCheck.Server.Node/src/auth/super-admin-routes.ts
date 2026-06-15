import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from './types.js';
import { signToken } from './jwt.js';
import bcrypt from 'bcryptjs';

export async function superAdminRoutes(app: FastifyInstance, db: IDatabase): Promise<void> {
  // POST /api/admin/super/login — 超级管理员登录
  app.post('/api/admin/super/login', async (request, reply) => {
    const body = request.body as any;
    const { username, password } = body ?? {};

    if (!username || !password) {
      return reply.status(400).send({ error: '缺少必填字段：username、password', code: 'VALIDATION_ERROR' });
    }

    const admin = await db.findSuperAdmin(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return reply.status(401).send({ error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' });
    }

    const token = signToken({
      sub: admin.id,
      tenant_id: admin.tenant_id,
      role: 'super_admin',
      token_version: admin.token_version,
    });
    return { token, username, needs_password_change: false };
  });

  // PUT /api/admin/super/credentials — 修改超级管理员凭证
  app.put('/api/admin/super/credentials', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'super_admin') {
      return reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const body = request.body as any;
    const { username: newUsername, password: newPassword } = body ?? {};
    if (!newUsername || !newPassword) {
      return reply.status(400).send({ error: '缺少必填字段：username、password', code: 'VALIDATION_ERROR' });
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: '密码长度不能少于6位', code: 'VALIDATION_ERROR' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await db.updateSuperAdminCredentials(payload.sub, newUsername, passwordHash);
    return { ok: true, message: '凭证已更新' };
  });

  // GET /api/admin/super/tenants — 所有租户列表
  app.get('/api/admin/super/tenants', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'super_admin') {
      return reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const tenants = await db.getAllTenants();
    return tenants;
  });

  // PATCH /api/admin/super/tenants/:id — 启用/禁用租户
  app.patch('/api/admin/super/tenants/:id', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'super_admin') {
      return reply.status(403).send({ error: '仅超级管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as any;
    const { is_active } = body ?? {};

    if (typeof is_active !== 'boolean') {
      return reply.status(400).send({ error: '缺少必填字段：is_active（布尔值）', code: 'VALIDATION_ERROR' });
    }

    await db.setTenantActive(id, is_active);
    return { ok: true };
  });
}
