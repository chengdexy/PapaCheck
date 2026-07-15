import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createDatabase } from './src/db/index.js';
import { AppError, ErrorCodes } from './src/errors.js';
import { authMiddleware } from './src/auth/middleware.js';
import { authRoutes } from './src/auth/routes.js';
import { adminRoutes } from './src/admin/routes.js';
import { superAdminRoutes } from './src/auth/super-admin-routes.js';
import rateLimit from '@fastify/rate-limit';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// 版本号从 package.json 读取（每次部署随代码更新，无需环境变量）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const CLIENT_VERSION = PKG.version || '1.5.2';

// CDN 基础地址固定
const CDN_BASE = 'https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la';

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
      // 全局默认限流下调：原 10000/分钟近乎无效。敏感路由（登录/兑换/注册）已单独降额。
      max: options.rateLimit?.max ?? 600,
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

  // ==================== child 作用域鉴权守卫（统一抽取，消除端点内重复片段） ====================
  // 语义保持与原有内联守卫完全一致：
  //   - parent/child 缺 child_id            → 400 MISSING_CHILD_ID
  //   - parent/child 的 child 不属于租户    → 403 FOREIGN_CHILD
  //   - admin/user 无 child 维度            → 返回 undefined，正常继续
  // 返回 null 表示已发送错误响应，调用方应直接 return。
  async function requireChild(request: any, reply: FastifyReply): Promise<string | undefined | null> {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = getChildId(request);
    if (childId === 'MISSING') {
      reply.status(400).send({ error: '缺少 child_id 参数', code: 'MISSING_CHILD_ID' });
      return null;
    }
    if (typeof childId === 'string') {
      const child = await db.getChildById(childId, tenantId);
      if (!child) {
        reply.status(403).send({ error: '无权限访问该孩子', code: 'FOREIGN_CHILD' });
        return null;
      }
    }
    return typeof childId === 'string' ? childId : undefined;
  }

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

  // 2. GET /api/version - 客户端版本号（从 package.json 读取）
  app.get('/api/version', { schema: versionSchema }, async (_request, reply) => {
    return sendJson(reply, { clientVersion: CLIENT_VERSION });
  });

  // 2b. GET /api/download - 下载最新 APK（重定向到 CloudBase CDN）
  app.get('/api/download', async (_request, reply) => {
    const cdnUrl = `${CDN_BASE}/dist/PapaCheck-${CLIENT_VERSION}.apk`;
    reply.redirect(302, cdnUrl);
  });

  // 3. GET /api/data - 完整数据
  app.get('/api/data', { schema: dataSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getFullData(tenantId, childId));
  });

  // 3b. GET /api/data-version - 轻量数据版本戳（条件短轮询用，仅返回几十字节）
  // 前端每 3s 轮询此端点，版本变化才触发全量 /api/data 拉取。
  // 版本戳为租户级（last_modified 无 child 维度），无需 child_id。
  app.get('/api/data-version', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const version = await db.getDataVersion(tenantId);
    return sendJson(reply, { version });
  });

  // 4. GET /api/homeworks/:date
  app.get<{ Params: { date: string } }>('/api/homeworks/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getHomeworks(request.params.date, tenantId, childId));
  });

  // 5. GET /api/settlement/:date
  app.get<{ Params: { date: string } }>('/api/settlement/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getRedemptions(tenantId, childId));
  });

  // 8. GET /api/reward-box
  app.get('/api/reward-box', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getActiveBuffs(tenantId, childId));
  });

  // 11. GET /api/efficiency/:date
  app.get<{ Params: { date: string } }>('/api/efficiency/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getEfficiency(request.params.date, tenantId, childId));
  });

  // 12. GET /api/freetime/:date
  app.get<{ Params: { date: string } }>('/api/freetime/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getBountySubmissions(request.params.date, tenantId, childId));
  });

  // 15. GET /api/bounty-completions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-completions/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    return sendJson(reply, await db.getBountyCompletions(request.params.date, tenantId, childId));
  });

  // 16. GET /api/sync/pull - 同步拉取
  app.get('/api/sync/pull', async (request: any, reply) => {
    const query = request.query as { lastSync?: string };
    const lastSync = query.lastSync || '1970-01-01T00:00:00+00:00';
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    const changes = await db.getModifiedSince(lastSync, tenantId, childId);
    return sendJson(reply, { changes, serverTime: new Date().toISOString() });
  });

  // 17. GET /api/speak - TTS 语音合成（通过 CloudBase callFunction 调用 tts-svc 云函数）
  app.get('/api/speak', async (request, reply) => {
    const { text } = request.query as { text?: string };
    if (!text || !text.trim()) {
      return reply.status(400).send({ error: 'Missing text' });
    }

    // 通过 CloudBase callFunction 调用 tts-svc 云函数
    let ttsResult;
    try {
      const { getCloudBaseApp } = await import('./cloudbase-ctx.js');
      const tcbApp = getCloudBaseApp();
      if (!tcbApp) {
        return reply.status(502).send({ error: 'CloudBase SDK not initialized' });
      }
      ttsResult = await tcbApp.callFunction({
        name: 'tts-svc',
        data: { text: text.trim(), timeout: 8 },
      });
    } catch (err) {
      console.error('[TTS] callFunction error:', err);
      return reply.status(502).send({ error: 'TTS service unavailable' });
    }

    const { ok, audio, error, content_type } = ttsResult?.result || {};
    if (!ok || !audio) {
      return reply.status(502).send({ error: error || 'TTS synthesis failed' });
    }

    // 将 base64 音频解码为二进制返回
    const audioBuffer = Buffer.from(audio as string, 'base64');
    reply.header('Content-Type', (content_type as string) || 'audio/mpeg');
    reply.send(audioBuffer);
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    // 同时兼容 { settlement: data } 和直接 data 两种 payload 格式
    await db.saveSettlement(request.params.date, body.settlement ?? body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 21. PATCH /api/points - 更新积分
  app.patch('/api/points', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.saveRedemptions(body.redemptions, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 23b. DELETE /api/redemptions/fulfilled — 清空已兑现记录
  app.delete('/api/redemptions/fulfilled', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.clearFulfilledRedemptions(tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 24. PUT /api/reward-box
  app.put('/api/reward-box', async (request: any, reply) => {
    const body = request.body as { items: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.saveActiveBuffs(body.buffs, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 27. PUT /api/efficiency/:date — 全量替换效率数据
  app.put<{ Params: { date: string } }>('/api/efficiency/:date', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.saveFreeTime(body.dateKey, body.tasks, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 28b. PUT /api/freetime/:id — 单条自由时间 upsert
  app.put<{ Params: { id: string } }>('/api/freetime/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.saveBountySubmissions(body.dateKey, body.submissions, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 30b. PUT /api/bounty-submissions/:id — 单条赏金提交 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-submissions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.saveBountyCompletions(body.dateKey, body.completions, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 31b. PUT /api/bounty-completions/:id — 单条赏金完成 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-completions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;

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
      // 并发安全：approve 路径的 read-modify-write 已在存储层（PostgresAdapter.approveDeferHomework）
      // 内以「事务 + SELECT ... FOR UPDATE 行锁」原子化，消除了原 TOCTOU 竞态。
      const result = await db.approveDeferHomework(date, hwId, tenantId, childId);
      if (result.ok && result.homework) {
        return sendJson(reply, { ok: true, homework: result.homework });
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.resetDate(body.date, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 34. POST /api/sync/push - 同步推送
  app.post('/api/sync/push', async (request: any, reply) => {
    const body = request.body as { changes: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    const result = await db.pushMerge(body.changes, tenantId, childId);
    return sendJson(reply, result);
  });

  // 35. POST /api/pregen-speech - 预生成语音（通过 CloudBase callFunction 调用 tts-svc）
  // 原实现直接 fetch('http://127.0.0.1:8500/pregen') 为本地开发地址，生产环境不可达会静默失败。
  // 现改为与 /api/speak 一致，走 CloudBase callFunction；错误不再被静默吞掉，而是记录并向上返回。
  app.post('/api/pregen-speech', async (request: any, reply) => {
    const { texts } = request.body as { texts?: string[] };
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return reply.status(400).send({ error: 'Missing texts' });
    }

    try {
      const { getCloudBaseApp } = await import('./cloudbase-ctx.js');
      const tcbApp = getCloudBaseApp();
      if (!tcbApp) {
        return reply.status(502).send({ error: 'CloudBase SDK not initialized' });
      }
      // tts-svc 每次只接受单条 text（与 /api/speak 一致），逐条预生成以预热 TTS 缓存。
      // 预生成为 best-effort 优化，个别文本失败不应返回 5xx 阻断管理端流程。
      let generated = 0;
      let failed = 0;
      for (const raw of texts) {
        const text = (raw || '').trim();
        if (!text) continue;
        try {
          const result = await tcbApp.callFunction({
            name: 'tts-svc',
            data: { text, timeout: 8 },
          });
          const { ok, error } = (result?.result as { ok?: boolean; error?: string }) || {};
          if (ok) {
            generated++;
          } else {
            failed++;
            console.error('[pregen-speech] tts-svc 返回失败:', error);
          }
        } catch (err) {
          failed++;
          console.error('[pregen-speech] 调用 tts-svc 失败:', err);
        }
      }
      return sendJson(reply, { ok: true, generated, failed });
    } catch (err) {
      console.error('[pregen-speech] 未预期错误:', err);
      return reply.status(500).send({ error: 'TTS pregen internal error' });
    }
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

  // ==================== 弃用端点（已于 2026-06 下线） ====================
  // 以下 CRDT 同步端点（/api/sync/write、/api/sync/crdt-push、/api/sync/crdt-pull）
  // 已被基于版本戳轮询的 /api/data-version + /api/data 取代，前端（Web/Site 的 realtime）
  // 不再调用。此处不再注册这些路由，避免暴露已弃用的跨租户同步能力。
  // 如需历史兼容，请使用 /api/sync/pull 与 /api/sync/push（版本戳驱动）。

  // ==================== PUT Endpoints（单资源 upsert） ====================

  // 35. PUT /api/homeworks/:id
  app.put<{ Params: { id: string } }>('/api/homeworks/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
    await db.patchHomework(request.params.id, request.body, tenantId, childId);
    return sendJson(reply, { ok: true });
  });

  // 48. PATCH /api/settlement/:date
  app.patch<{ Params: { date: string } }>('/api/settlement/:date', { schema: dateParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
    const childId = await requireChild(request, reply);
    if (childId === null) return;
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
