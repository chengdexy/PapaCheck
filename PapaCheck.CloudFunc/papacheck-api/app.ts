import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createDatabase } from './src/db/index.js';
import { AppError, ErrorCodes } from './src/errors.js';
import type { CRDTOperation } from './src/crdt/types.js';
import { authMiddleware } from './src/auth/middleware.js';
import { authRoutes } from './src/auth/routes.js';
import { adminRoutes } from './src/admin/routes.js';
import { superAdminRoutes } from './src/auth/super-admin-routes.js';
import rateLimit from '@fastify/rate-limit';

export interface AppOptions {
  /** 启用 JWT Bearer 认证（生产环境设为 true） */
  enableAuth?: boolean;
  /** 速率限制配置，设为 false 可禁用 */
  rateLimit?: false | { max?: number; timeWindow?: string };
}

/** 设置 Content-Type: application/json; charset=utf-8 并返回数据 */
function sendJson(reply: FastifyReply, data: unknown): unknown {
  reply.header('Content-Type', 'application/json; charset=utf-8');
  return data;
}

// ==================== JSON Schema 定义 ====================

const pingSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        serverTime: { type: 'string' },
      },
      required: ['ok', 'serverTime'],
    },
  },
};

const versionSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        clientVersion: { type: 'string' },
      },
      required: ['clientVersion'],
    },
  },
};

const dataSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: true,
    },
  },
};

/** 计算指定日期的下一天（YYYY-MM-DD） */
function getTomorrow(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `无效的日期格式: ${dateStr}`);
  }
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `无效的日期: ${dateStr}`);
  }
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 提取 child_id：从 JWT 中直接获取 */
function getChildId(request: any): string | undefined | 'MISSING' {
  const payload = request.jwtPayload;
  if (!payload) return undefined;
  // Admin/user 角色无 child_id，不需要获取
  if (payload.role === 'admin' || payload.role === 'user') return undefined;
  // parent/child 角色在新模型下 JWT 必定含 child_id
  return payload.child_id ?? 'MISSING';
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  // ==================== 速率限制 ====================

  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      max: options.rateLimit?.max ?? 10000,
      timeWindow: options.rateLimit?.timeWindow ?? '1 minute',
      errorResponseBuilder: (request, context) => ({
        error: '请求过于频繁，请稍后再试',
        code: 'RATE_LIMIT_EXCEEDED',
        statusCode: 429,
      }),
    });
  }

  // ==================== 请求日志 ====================

  app.addHook('onResponse', (request, reply, done) => {
    const url = request.url;
    // 服务端不做日志过滤，由 Windows 客户端根据本地配置决定是否显示
    console.log(`${request.method} ${url} ${reply.statusCode}`);
    done();
  });

  // ==================== 全局错误处理器 ====================

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }

    // Fastify 内置校验错误（来自 JSON Schema）
    const fastifyErr = error as any;
    if (fastifyErr.validation) {
      return reply.status(400).send({
        error: '请求参数校验失败',
        code: ErrorCodes.VALIDATION_ERROR,
        details: fastifyErr.validation,
      });
    }

    // Fastify 插件抛出的结构化错误（@fastify/rate-limit 等附加 statusCode/code 属性的 Error 实例）
    const plainErr = error as any;
    if (plainErr && typeof plainErr === 'object' && plainErr.code) {
      return reply.status(plainErr.statusCode || 500).send({
        error: plainErr.error || '请求被拒绝',
        code: plainErr.code,
      });
    }

    // 未知错误
    console.error('未处理的错误:', error);
    return reply.status(500).send({
      error: '服务器内部错误',
      code: ErrorCodes.INTERNAL_ERROR,
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: '请求的资源不存在',
      code: ErrorCodes.NOT_FOUND,
    });
  });

  // 创建数据库
  const db = await createDatabase({});

  // 暴露给测试使用
  app.decorate('papaCheckDB', db);

  // ==================== CORS ====================

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // ==================== JWT Bearer 认证 (Phase 5c, 替代旧的 Cookie Session authPlugin) ====================

  if (options.enableAuth) {
    await authMiddleware(app, { db });
    await authRoutes(app, db);
    await adminRoutes(app, db);
    await superAdminRoutes(app, db);
  }

  // ==================== GET Endpoints ====================

  // 1. GET /api/ping - 心跳（宽松限流，避免耗尽全局额度）
  app.get('/api/ping', { schema: pingSchema, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (_request, reply) => {
    return sendJson(reply, { ok: true, serverTime: new Date().toISOString() });
  });

  // 2. GET /api/version - 客户端版本号
  app.get('/api/version', { schema: versionSchema }, async (_request, reply) => {
    return sendJson(reply, { clientVersion: process.env.APK_VERSION || '1.5.2' });
  });

  // 2b. GET /api/download - 下载最新 APK（重定向到 CloudBase CDN）
  app.get('/api/download', async (_request, reply) => {
    const version = process.env.APK_VERSION || '1.5.2';
    const cdnUrl = process.env.APK_CDN_URL
      || `https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la/dist/PapaCheck-${version}.apk`;
    reply.redirect(302, cdnUrl);
  });

  // 3. GET /api/data - 完整数据
  app.get('/api/data', { schema: dataSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getFullData(tenantId, childId));
  });

  // 4. GET /api/homeworks/:date
  app.get<{ Params: { date: string } }>('/api/homeworks/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getHomeworks(request.params.date, tenantId, childId));
  });

  // 5. GET /api/settlement/:date
  app.get<{ Params: { date: string } }>('/api/settlement/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getSettlement(request.params.date, tenantId, childId));
  });

  // 6. GET /api/shop
  app.get('/api/shop', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getShopItems(tenantId));
  });

  // 7. GET /api/redemptions
  app.get('/api/redemptions', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getRedemptions(tenantId, childId));
  });

  // 8. GET /api/reward-box
  app.get('/api/reward-box', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getRewardBox(tenantId, childId));
  });

  // 9. GET /api/settings
  app.get('/api/settings', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getSettings(tenantId));
  });

  // 10. GET /api/active-buffs
  app.get('/api/active-buffs', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getActiveBuffs(tenantId, childId));
  });

  // 11. GET /api/efficiency/:date
  app.get<{ Params: { date: string } }>('/api/efficiency/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getEfficiency(request.params.date, tenantId, childId));
  });

  // 12. GET /api/freetime/:date
  app.get<{ Params: { date: string } }>('/api/freetime/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getFreeTime(request.params.date, tenantId, childId));
  });

  // 13. GET /api/bounty-tasks
  app.get('/api/bounty-tasks', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getBountyTasks(tenantId));
  });

  // 14. GET /api/bounty-submissions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-submissions/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getBountySubmissions(request.params.date, tenantId, childId));
  });

  // 15. GET /api/bounty-completions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-completions/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    return sendJson(reply, await db.getBountyCompletions(request.params.date, tenantId, childId));
  });

  // 16. GET /api/sync/pull - 同步拉取
  app.get('/api/sync/pull', async (request: any, reply) => {
    const query = request.query as { lastSync?: string };
    const lastSync = query.lastSync || '1970-01-01T00:00:00+00:00';
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    const changes = await db.getModifiedSince(lastSync, tenantId, childId);
    return sendJson(reply, { changes, serverTime: new Date().toISOString() });
  });

  // 17. GET /api/speak - TTS 语音合成（转发到 tts-svc）
  app.get('/api/speak', async (request, reply) => {
    const { text } = request.query as { text?: string };
    if (!text || !text.trim()) {
      return reply.status(400).send({ error: 'Missing text' });
    }

    const ttsResponse = await fetch('http://127.0.0.1:8500/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), timeout: 8, cache: true }),
    });

    if (!ttsResponse.ok) {
      const errBody = await ttsResponse.json().catch(() => ({}));
      return reply.status(ttsResponse.status).send(errBody);
    }

    // Stream the response back to the client
    const contentType = ttsResponse.headers.get('content-type') || 'audio/mpeg';
    const contentLength = ttsResponse.headers.get('content-length');

    reply.raw.writeHead(200, {
      'Content-Type': contentType,
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
    });

    const reader = ttsResponse.body?.getReader();
    if (reader) {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              reply.raw.end();
              break;
            }
            reply.raw.write(value);
          }
        } catch (err) {
          reply.raw.destroy(err as Error);
        }
      };
      pump();
    } else {
      reply.raw.end();
    }

    return reply.hijack();
  });

  // ==================== POST Endpoints ====================

  // 18. POST /api/data - 导入完整数据
  app.post('/api/data', async (request: any, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: '请求体必须是 JSON 对象' });
    }
    // 估算大小：序列化后超过 10MB 拒绝
    const raw = JSON.stringify(body);
    if (raw.length > 10 * 1024 * 1024) {
      return reply.status(413).send({ error: '数据过大，最大允许 10MB' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    await db.importFullData(body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 19. PUT /api/homeworks — 全量替换当日作业列表（body 含 dateKey + homeworks）
  app.put('/api/homeworks', async (request: any, reply) => {
    const body = request.body as { dateKey?: string; homeworks: unknown[] };
    const dateKey = body.dateKey;
    if (!dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveHomeworks(dateKey, body.homeworks, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 共享 schema：确保 id/date 参数必填（被后面多个单资源 PUT/DELETE 路由使用）
  const idParamSchema = {
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
    body: { type: 'object' },
  };
  const dateParamSchema = {
    params: { type: 'object', required: ['date'], properties: { date: { type: 'string', minLength: 10 } } },
    body: { type: 'object' },
  };
  const deleteParamSchema = {
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
  };

  // 20. PUT /api/settlement/:date — 全量替换结算数据
  app.put<{ Params: { date: string } }>('/api/settlement/:date', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    // 同时兼容 { settlement: data } 和直接 data 两种 payload 格式
    await db.saveSettlement(request.params.date, body.settlement ?? body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 21. PATCH /api/points - 更新积分
  app.patch('/api/points', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    if (body.action) {
      if (body.action !== 'earn' && body.action !== 'spend') {
        return reply.status(400).send({ error: 'action 必须是 earn 或 spend' });
      }
      // 全量替换风格（原 POST /api/points）
      const balance = await db.updatePoints(body.action, body.amount, body.detail, tenantId, childId);
      return sendJson(reply, { ok: true, balance });
    }
    // 增量更新风格（原 PATCH /api/points）
    const balance = await db.patchPoints(body, tenantId, childId);
    return sendJson(reply, { ok: true, balance });
  });

  // 22. PUT /api/shop
  app.put('/api/shop', async (request: any, reply) => {
    const body = request.body as { items: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    await db.saveShopItems(body.items, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 23. PUT /api/redemptions
  app.put('/api/redemptions', async (request: any, reply) => {
    const body = request.body as { redemptions: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveRedemptions(body.redemptions, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 23b. DELETE /api/redemptions/fulfilled — 清空已兑现记录
  app.delete('/api/redemptions/fulfilled', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.clearFulfilledRedemptions(tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 24. PUT /api/reward-box
  app.put('/api/reward-box', async (request: any, reply) => {
    const body = request.body as { items: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveRewardBox(body.items, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 25. PUT /api/settings — 全量替换设置
  app.put('/api/settings', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    // 同时兼容 { settings: data } 和直接 data 两种 payload 格式
    await db.saveSettings(body.settings ?? body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 26. PUT /api/active-buffs
  app.put('/api/active-buffs', async (request: any, reply) => {
    const body = request.body as { buffs: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveActiveBuffs(body.buffs, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 27. PUT /api/efficiency/:date — 全量替换效率数据
  app.put<{ Params: { date: string } }>('/api/efficiency/:date', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    // 同时兼容 { efficiency: data } 和直接 data 两种 payload 格式
    await db.saveEfficiency(request.params.date, body.efficiency ?? body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 28. PUT /api/freetime — 全量替换自由时间（body 含 dateKey + tasks）
  app.put('/api/freetime', async (request: any, reply) => {
    const body = request.body as { dateKey?: string; tasks: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveFreeTime(body.dateKey, body.tasks, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 28b. PUT /api/freetime/:id — 单条自由时间 upsert
  app.put<{ Params: { id: string } }>('/api/freetime/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.putFreeTimeTask(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 29. PUT /api/bounty-tasks
  app.put('/api/bounty-tasks', async (request: any, reply) => {
    const body = request.body as { items: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    await db.saveBountyTasks(body.items, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 30. PUT /api/bounty-submissions — 全量替换赏金提交（body 含 dateKey + submissions）
  app.put('/api/bounty-submissions', async (request: any, reply) => {
    const body = request.body as { dateKey?: string; submissions: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveBountySubmissions(body.dateKey, body.submissions, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 30b. PUT /api/bounty-submissions/:id — 单条赏金提交 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-submissions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.putBountySubmission(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 31. PUT /api/bounty-completions — 全量替换赏金完成（body 含 dateKey + completions）
  app.put('/api/bounty-completions', async (request: any, reply) => {
    const body = request.body as { dateKey?: string; completions: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.saveBountyCompletions(body.dateKey, body.completions, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 31b. PUT /api/bounty-completions/:id — 单条赏金完成 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-completions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.putBountyCompletion(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 32. POST /api/defer-homework - 延迟作业（请求/批准/拒绝）
  app.post('/api/defer-homework', async (request: any, reply) => {
    const body = request.body as {
      date: string;
      hwId: string;
      action: 'request' | 'approve' | 'reject';
      requestedAt?: string;
    };
    const { date, hwId, action, requestedAt } = body;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }

    if (action === 'request') {
      const homeworks = await db.getHomeworks(date, tenantId, childId);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found && found.status === 'pending' && !found.deferRequest) {
        found.deferRequest = {
          requestedAt: requestedAt || new Date().toISOString(),
          status: 'pending',
        };
        await db.saveHomeworks(date, homeworks, tenantId, childId);
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'approve') {
      const homeworks = await db.getHomeworks(date, tenantId, childId);
      const idx = homeworks.findIndex((h: any) => h.id === hwId);
      if (idx !== -1) {
        const hw = { ...homeworks[idx] };
        delete hw.deferRequest;
        hw.status = 'pending';

        // 从当前日期移除
        homeworks.splice(idx, 1);
        await db.saveHomeworks(date, homeworks, tenantId, childId);

        // 添加到次日
        const tomorrow = getTomorrow(date);
        hw.date = tomorrow;
        const tomorrowHw = await db.getHomeworks(tomorrow, tenantId, childId);
        tomorrowHw.push(hw);
        await db.saveHomeworks(tomorrow, tomorrowHw, tenantId, childId);

        return sendJson(reply, { ok: true, homework: hw });
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'reject') {
      const homeworks = await db.getHomeworks(date, tenantId, childId);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found) {
        delete found.deferRequest;
        await db.saveHomeworks(date, homeworks, tenantId, childId);
      }
      return sendJson(reply, { ok: true });
    }

    return sendJson(reply, { ok: true });
  });

  // 33. POST /api/reset-date - 重置日期数据
  app.post('/api/reset-date', async (request: any, reply) => {
    const body = request.body as { date: string };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.resetDate(body.date, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 34. POST /api/sync/push - 同步推送
  app.post('/api/sync/push', async (request: any, reply) => {
    const body = request.body as { changes: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    const result = await db.pushMerge(body.changes, tenantId, childId);
    return sendJson(reply, result);
  });

  // 35. POST /api/pregen-speech - 预生成语音（转发到 tts-svc）
  app.post('/api/pregen-speech', async (request, reply) => {
    const { texts } = request.body as { texts?: string[] };
    if (!texts) {
      return reply.status(400).send({ error: 'Missing texts' });
    }

    // Fire-and-forget to tts-svc
    fetch('http://127.0.0.1:8500/pregen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    }).catch((err: Error) => {
      console.error('Failed to forward pregen to tts-svc:', err);
    });

    return { ok: true };
  });

  // 通知：创建通知
  app.post('/api/notify', async (request: any, reply) => {
    const body = request.body as { text?: string };
    if (!body.text || !body.text.trim()) {
      return reply.status(400).send({
        error: '通知内容不能为空',
        code: 'VALIDATION_ERROR',
      });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    const id = await db.addNotification(body.text.trim(), undefined, tenantId);
    return sendJson(reply, { ok: true, id });
  });

  // 通知：拉取待消费通知（自动清理过期）
  app.get('/api/notify/pending', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const items = await db.getPendingNotifications(tenantId);
    return sendJson(reply, { items });
  });

  // 通知：消费通知
  app.delete('/api/notify/consumed', async (request: any, reply) => {
    const query = request.query as { ids?: string };
    const tenantId = request.jwtPayload?.tenant_id;
    if (query.ids) {
      const ids = query.ids.split(',').filter(Boolean);
      if (ids.length > 0) {
        await db.consumeNotifications(ids, tenantId);
      }
    }
    return sendJson(reply, { ok: true });
  });

  // 统一写端点（供乐观写入和原生队列使用）
  app.post('/api/sync/write', async (request: any, reply) => {
    const op = request.body as CRDTOperation;
    const tenantId = request.jwtPayload?.tenant_id;
    const existed = await db.hasCRDTOperation(op.id, tenantId);
    await db.saveCRDTOperation(op, tenantId);
    if (!existed) {
      await db.applyCRDTOperation(op, tenantId);
    }
    return sendJson(reply, { ok: true });
  });

  // CRDT 同步推送
  app.post('/api/sync/crdt-push', async (request: any, reply) => {
    const body = request.body as { operations: CRDTOperation[] };
    if (!body.operations || !Array.isArray(body.operations)) {
      return reply.status(400).send({ error: '缺少 operations 数组', code: 'VALIDATION_ERROR' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    for (const op of body.operations) {
      const existed = await db.hasCRDTOperation(op.id, tenantId);
      await db.saveCRDTOperation(op, tenantId);
      if (!existed) {
        await db.applyCRDTOperation(op, tenantId);
      }
    }
    return sendJson(reply, { ok: true });
  });

  // CRDT 增量拉取
  app.get('/api/sync/crdt-pull', async (request: any, reply) => {
    const query = request.query as { since?: string };
    const since = query.since || '1970-01-01T00:00:00Z';
    const tenantId = request.jwtPayload?.tenant_id;
    const operations = await db.getCRDTOperationsSince(since, tenantId);
    return sendJson(reply, { operations });
  });

  // CRDT 确认消费
  app.delete('/api/sync/crdt-pull', async (request: any, reply) => {
    const query = request.query as { ack?: string };
    const tenantId = request.jwtPayload?.tenant_id;
    if (query.ack) {
      await db.ackCRDTOperations(query.ack, tenantId);
    }
    return sendJson(reply, { ok: true });
  });

  // ==================== PUT Endpoints（单资源 upsert） ====================

  // 35. PUT /api/homeworks/:id
  app.put<{ Params: { id: string } }>('/api/homeworks/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.putHomework(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 37. PUT /api/shop/:id
  app.put<{ Params: { id: string } }>('/api/shop/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putShopItem(request.params.id, request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 38. PUT /api/redemptions/:id
  app.put<{ Params: { id: string } }>('/api/redemptions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const data = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    // 检查同一 rewardBoxItemId 是否已有 pending 兑换（服务端兜底）
    if (data && data.fromRewardBox && data.status === 'pending' && data.rewardBoxItemId) {
      const redemptions = await db.getRedemptions(tenantId, childId);
      const existing = redemptions.find((r: any) =>
        r.rewardBoxItemId === data.rewardBoxItemId &&
        r.status === 'pending' &&
        r.id !== request.params.id
      );
      if (existing) {
        return reply.code(409).send({ ok: false, error: 'duplicate_pending_redemption', message: '该物品已有待处理兑换申请' });
      }
    }
    await db.putRedemption(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 39. PUT /api/reward-box/:id
  app.put<{ Params: { id: string } }>('/api/reward-box/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putRewardBoxItem(request.params.id, request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 40. DELETE /api/reward-box/:id
  app.delete<{ Params: { id: string } }>('/api/reward-box/:id', { schema: deleteParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.deleteRewardBoxItem(request.params.id, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 41. PUT /api/active-buffs/:id
  app.put<{ Params: { id: string } }>('/api/active-buffs/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putBuff(request.params.id, request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 44. PUT /api/bounty-tasks/:id
  app.put<{ Params: { id: string } }>('/api/bounty-tasks/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putBountyTask(request.params.id, request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // ==================== PATCH Endpoints ====================

  // 47. PATCH /api/homeworks/:id
  app.patch<{ Params: { id: string } }>('/api/homeworks/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.patchHomework(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 48. PATCH /api/settlement/:date
  app.patch<{ Params: { date: string } }>('/api/settlement/:date', { schema: dateParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.patchSettlement(request.params.date, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 50. PATCH /api/settings
  app.patch('/api/settings', { schema: { body: { type: 'object' } } }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.patchSettings(request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // ==================== DELETE Endpoints ====================

  // 51. DELETE /api/homeworks/:id
  app.delete<{ Params: { id: string } }>('/api/homeworks/:id', { schema: deleteParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      return reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        return reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
      }
    }
    await db.deleteHomework(request.params.id, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 52. DELETE /api/shop/:id
  app.delete<{ Params: { id: string } }>('/api/shop/:id', { schema: deleteParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.deleteShopItem(request.params.id, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 53. DELETE /api/active-buffs/:id
  app.delete<{ Params: { id: string } }>('/api/active-buffs/:id', { schema: deleteParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.deleteBuff(request.params.id, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 54. DELETE /api/bounty-tasks/:id
  app.delete<{ Params: { id: string } }>('/api/bounty-tasks/:id', { schema: deleteParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.deleteBountyTask(request.params.id, tenantId);
    return sendJson(reply, { ok: true });
  });

  // ==================== HEAD Endpoints ====================

  // 55. HEAD /api/shop/:id
  app.head<{ Params: { id: string } }>('/api/shop/:id', { schema: { params: idParamSchema.params } }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const item = await db.getShopItemById(request.params.id, tenantId);
    if (!item) {
      return reply.status(404).send();
    }
    return reply.status(200).send();
  });

  // 56. HEAD /api/bounty-tasks/:id
  app.head<{ Params: { id: string } }>('/api/bounty-tasks/:id', { schema: { params: idParamSchema.params } }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const item = await db.getBountyTaskById(request.params.id, tenantId);
    if (!item) {
      return reply.status(404).send();
    }
    return reply.status(200).send();
  });

  // HEAD /api/homeworks/:id 由 Fastify 从 GET /api/homeworks/:date 自动生成
  // 由于该路由按日期查询返回数组，HEAD 始终返回 200（含空数组），不做存在性检查

  // ==================== Graceful Shutdown ====================

  app.addHook('onClose', async (_instance) => {
    await db.close();
  });

  return app;
}
