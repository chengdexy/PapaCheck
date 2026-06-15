import type { FastifyInstance } from 'fastify';
import type { IDatabase } from '../db/types.js';
import type { JWTPayload } from '../auth/types.js';
import { signToken } from '../auth/jwt.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

function generateAccessHash(): { raw: string; hashed: string } {
  const raw = 'pc-' + crypto.randomBytes(16).toString('hex');
  const hashed = bcrypt.hashSync(raw, 10);
  return { raw, hashed };
}

export async function adminRoutes(app: FastifyInstance, db: IDatabase): Promise<void> {
  // POST /api/auth/register — 管理员注册
  app.post('/api/auth/register', async (request, reply) => {
    const body = request.body as any;
    const { email, password, family_name } = body ?? {};

    if (!email || !password || !family_name) {
      return reply.status(400).send({ error: '缺少必填字段：email、password、family_name', code: 'VALIDATION_ERROR' });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: '密码长度不能少于6位', code: 'VALIDATION_ERROR' });
    }

    // 优先复用已有默认租户（含旧数据），不存在则创建新租户
    const existingTenants = await db.getAllTenants();
    const defaultTenant = existingTenants.find(t => t.name === '默认租户' || t.name === '系统管理');
    const tenantId = defaultTenant?.id ?? crypto.randomUUID();
    if (defaultTenant) {
      // 复用默认租户，更新为家庭名称
      await db.updateTenantName(tenantId, family_name);
    } else {
      await db.createTenant(tenantId, family_name);
    }

    const userId = crypto.randomUUID();
    const { raw, hashed } = generateAccessHash();
    const passwordHash = bcrypt.hashSync(password, 10);

    await db.createUser({
      id: userId,
      tenant_id: tenantId,
      role: 'parent',
      nickname: email.split('@')[0],
      access_hash: hashed,
      token_version: 1,
      email,
      password_hash: passwordHash,
    });
    await db.updateTenantAdmin(tenantId, userId);

    return { ok: true, tenant_id: tenantId, admin_hash: raw, message: '注册成功' };
  });

  // POST /api/auth/login — 管理员登录
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as any;
    const { email, password } = body ?? {};

    if (!email || !password) {
      return reply.status(400).send({ error: '缺少必填字段：email、password', code: 'VALIDATION_ERROR' });
    }

    const admin = await db.findAdminByEmail(email);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
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
      access_hash: m.access_code_plaintext ?? m.access_hash,
      token_version: m.token_version,
      last_login: m.last_login,
      created_at: m.created_at,
    }));
  });

  // POST /api/admin/members — 添加成员
  app.post('/api/admin/members', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const body = request.body as any;
    const { role, nickname } = body ?? {};
    if (!role || !nickname) {
      return reply.status(400).send({ error: '缺少必填字段：role、nickname', code: 'VALIDATION_ERROR' });
    }
    if (!['parent', 'child'].includes(role)) {
      return reply.status(400).send({ error: '角色必须是 parent 或 child', code: 'VALIDATION_ERROR' });
    }

    const userId = crypto.randomUUID();
    const { raw, hashed } = generateAccessHash();
    await db.createUser({
      id: userId,
      tenant_id: payload.tenant_id,
      role,
      nickname,
      access_hash: hashed,
      access_code_plaintext: raw,
      token_version: 1,
    });

    return { id: userId, nickname, role, access_hash: raw };
  });

  // POST /api/admin/members/:id/regenerate — 重新生成 hash
  app.post('/api/admin/members/:id/regenerate', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    const { raw, hashed } = generateAccessHash();
    await db.regenerateMemberHash(id, payload.tenant_id, hashed, raw);
    return { id, access_hash: raw, message: '已重新生成，旧访问码已失效' };
  });

  // DELETE /api/admin/members/:id — 移除成员
  app.delete('/api/admin/members/:id', async (request: any, reply) => {
    const payload = request.jwtPayload as JWTPayload;
    if (!payload || payload.role !== 'parent') {
      return reply.status(403).send({ error: '仅管理员可执行此操作', code: 'FORBIDDEN' });
    }

    const { id } = request.params as { id: string };
    await db.deactivateMember(id, payload.tenant_id);
    return { ok: true };
  });
}
