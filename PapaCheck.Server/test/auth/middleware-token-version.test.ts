import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signToken } from '../../src/auth/jwt.js';
import type { IDatabase } from '../../src/db/types.js';

// ============================================================
// Bug 复现：家长使用访问码登录客户端管理端，无限重复提示输入访问码
//
// 根因：auth/middleware.ts 对所有角色统一用 users.token_version 验证，
// 但 parent/child 的 JWT token_version 来自 access_codes 表。
// 当 users.token_version（因改密码递增）> access_codes.token_version 时，
// 中间件错误地返回 401，导致无限循环。
//
// 修复方案：中间件根据 role 区分验证逻辑
//   - admin/user: 查 users 表 token_version（现有逻辑）
//   - parent/child: 查 access_codes 表 token_version（通过 member_id）
// ============================================================

describe('Auth Middleware — token_version 角色区分验证', () => {
  let app: FastifyInstance;
  let db: IDatabase;

  const USER_ID = 'user-914724771';
  const PARENT_MEMBER_ID = 'member-parent-baba';
  const CHILD_MEMBER_ID = 'member-child-xuejiayi';

  beforeAll(async () => {
    app = Fastify();
    // 模拟生产环境数据：
    //   - 用户账号 914724771@qq.com 的 users.token_version = 4（改过 3 次密码）
    //   - 家长"爸爸"的 access_codes.token_version = 2（重新生成过 1 次）
    //   - 孩子"薛嘉逸"的 access_codes.token_version = 5
    db = {
      // users 表的 token_version（仅对 admin/user 角色有效）
      queryUserTokenVersion: async (userId: string) => {
        if (userId === USER_ID) return 4;
        return 1;
      },
      // access_codes 表查询（用于 parent/child 验证）
      getAccessCodeById: async (id: string) => {
        if (id === PARENT_MEMBER_ID) {
          return {
            id,
            user_id: USER_ID,
            type: 'parent' as const,
            code_hash: 'hash',
            nickname: '爸爸',
            token_version: 2,
            created_at: '2026-06-16T18:31:15.116Z',
          };
        }
        if (id === CHILD_MEMBER_ID) {
          return {
            id,
            user_id: USER_ID,
            type: 'child' as const,
            code_hash: 'hash',
            nickname: '薛嘉逸',
            token_version: 5,
            created_at: '2026-06-15T13:10:13.898Z',
          };
        }
        return null;
      },
    } as any as IDatabase;

    await authMiddleware(app, { db });

    app.get('/api/test-auth', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Feature: parent/child 访问码登录的 token_version 验证
  //   Scenario: 家长访问码登录后，即使所属用户账号改过密码（users.token_version 更高），
  //            只要 access_codes.token_version 与 JWT 一致，请求应通过
  //     Given 家长"爸爸"的 access_codes.token_version = 2
  //     And   所属用户账号 users.token_version = 4（改过密码）
  //     And   JWT 中 token_version = 2（来自 access_codes），role = parent，member_id = 爸爸的 access_code id
  //     When  携带该 JWT 访问受保护路径 /api/test-auth
  //     Then  返回 200（不应因 users.token_version 更高而拒绝）
  it('家长访问码登录 — access_codes.token_version 与 JWT 一致时应通过', async () => {
    const token = signToken({
      sub: USER_ID,
      tenant_id: USER_ID,
      member_id: PARENT_MEMBER_ID,
      role: 'parent',
      token_version: 2,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // Feature: parent/child 访问码登录的 token_version 验证
  //   Scenario: 家长访问码被重新生成后，旧 JWT（token_version 较低）应被拒绝
  //     Given 家长"爸爸"的 access_codes.token_version = 2（重新生成后）
  //     And   旧 JWT 中 token_version = 1（重新生成前签发的）
  //     When  携带旧 JWT 访问受保护路径 /api/test-auth
  //     Then  返回 401（旧 token 应失效）
  it('家长访问码重新生成后 — 旧 JWT 应被拒绝', async () => {
    const token = signToken({
      sub: USER_ID,
      tenant_id: USER_ID,
      member_id: PARENT_MEMBER_ID,
      role: 'parent',
      token_version: 1, // 重新生成前的旧 token
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: parent/child 访问码登录的 token_version 验证
  //   Scenario: 孩子访问码登录后，access_codes.token_version 与 JWT 一致时应通过
  //     Given 孩子"薛嘉逸"的 access_codes.token_version = 5
  //     And   所属用户账号 users.token_version = 4
  //     And   JWT 中 token_version = 5（来自 access_codes），role = child
  //     When  携带该 JWT 访问受保护路径 /api/test-auth
  //     Then  返回 200
  it('孩子访问码登录 — access_codes.token_version 与 JWT 一致时应通过', async () => {
    const token = signToken({
      sub: USER_ID,
      tenant_id: USER_ID,
      member_id: CHILD_MEMBER_ID,
      role: 'child',
      token_version: 5,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // Feature: admin/user 账号登录的 token_version 验证（回归保护）
  //   Scenario: 用户账号改密码后，旧 JWT 应被拒绝（保持现有逻辑）
  //     Given 用户账号 users.token_version = 4
  //     And   旧 JWT 中 token_version = 1（改密码前签发的），role = user
  //     When  携带旧 JWT 访问受保护路径 /api/test-auth
  //     Then  返回 401
  it('用户账号改密码后 — 旧 JWT 应被拒绝（回归保护）', async () => {
    const token = signToken({
      sub: USER_ID,
      tenant_id: USER_ID,
      role: 'user',
      token_version: 1, // 改密码前的旧 token
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // Feature: admin/user 账号登录的 token_version 验证（回归保护）
  //   Scenario: 用户账号 JWT token_version 与 users.token_version 一致时应通过
  //     Given 用户账号 users.token_version = 4
  //     And   JWT 中 token_version = 4，role = user
  //     When  携带该 JWT 访问受保护路径 /api/test-auth
  //     Then  返回 200
  it('用户账号 — token_version 一致时应通过（回归保护）', async () => {
    const token = signToken({
      sub: USER_ID,
      tenant_id: USER_ID,
      role: 'user',
      token_version: 4,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/test-auth',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
