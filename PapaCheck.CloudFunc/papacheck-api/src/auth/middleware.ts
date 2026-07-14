import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IDatabase } from '../db/types.js';
import { verifyToken } from './jwt.js';

// PUBLIC_PATHS: 放行的公开 API 路径
// 新增公开路由时请同步更新此集合，避免意外拦截
// 注：/api/speak 已于 2026-06-18 改为需鉴权，防止匿名滥用 TTS 上游
const PUBLIC_PATHS = new Set([
  '/api/ping',
  '/api/version',
  '/api/static-version',
  '/api/download',
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
    // 注意：parent/child 的 JWT token_version 来自 access_codes 表，
    // admin/user 的来自 users 表，必须按角色分别查询，避免跨表比较。
    try {
      let currentTokenVersion: number;
      if (payload.role === 'parent' || payload.role === 'child') {
        // parent/child：通过 member_id（access_code id）查询 access_codes 表的 token_version
        const memberId = payload.member_id ?? payload.sub;
        const accessCode = await db.getAccessCodeById(memberId);
        if (!accessCode) {
          return reply.status(401).send({ error: '访问码不存在或已删除', code: 'SESSION_EXPIRED' });
        }
        currentTokenVersion = accessCode.token_version;
      } else {
        // admin/user：查询 users 表的 token_version
        currentTokenVersion = await db.queryUserTokenVersion(payload.sub);
      }
      if (payload.token_version < currentTokenVersion) {
        return reply.status(401).send({ error: '认证已过期，请重新登录', code: 'SESSION_EXPIRED' });
      }
    } catch (err: any) {
      // 区分「表不存在（旧库兼容）」与「查询异常（安全优先拒绝）」
      const msg = String(err?.message ?? err ?? '');
      const isMissingTable = /relation .* does not exist|no such table|undefined_table|42P01/i.test(msg);
      if (isMissingTable) {
        // 旧数据库尚未建表，按兼容逻辑放行（仍记录以便排查）
        console.warn('[auth] users/access_codes 表不存在，按旧库兼容放行 token_version 校验');
        return;
      }
      // fail-closed：任何非预期的查询异常都拒绝请求，避免吊销失效
      console.error('[auth] 查询 token_version 失败，安全起见拒绝请求:', err);
      return reply.status(401).send({ error: '认证校验失败，请重新登录', code: 'AUTH_CHECK_FAILED' });
    }

    // 注入 payload
    (request as any).jwtPayload = payload;
  });
}
