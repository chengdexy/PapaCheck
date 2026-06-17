import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { readdir, stat, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { createDatabase } from './db/index.js';
import { TTSBridge, _moduleDirname } from './tts/index.js';
import { EmailSync } from './email/index.js';
import type { HomeworkItem } from './email/ai.js';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { AppError, ErrorCodes } from './errors.js';
import type { CRDTOperation } from './crdt/types.js';
import { authMiddleware } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { adminRoutes } from './admin/routes.js';
import { superAdminRoutes } from './auth/super-admin-routes.js';
import { ensureSuperAdmin } from './auth/super-admin.js';
import { OpsScheduler } from './ops/ops-scheduler.js';
import { opsRoutes } from './routes/ops-routes.js';
import rateLimit from '@fastify/rate-limit';

export interface AppOptions {
  port: number;
  webDir: string;
  dbPath: string;
  ttsPython?: string;
  showPollingLog?: boolean;
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

const staticVersionSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        version: { type: 'string' },
      },
      required: ['version'],
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

  // 创建数据库和 TTS 实例
  const db = await createDatabase({ dbPath: options.dbPath });
  const tts = new TTSBridge({
    pythonPath: options.ttsPython ?? 'python',
    cacheDir: join(dirname(options.dbPath ?? join(_moduleDirname, '..', 'data.db')), 'tts_cache'),
  });

  // 暴露给测试使用
  app.decorate('papaCheckDB', db);
  app.decorate('tts', tts);

  // ==================== CORS ====================

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // 为所有 /api/* 路由自动添加 OpenAPI 标签，确保 Swagger 文档可见
  app.addHook('onRoute', (routeOptions) => {
    const url = routeOptions.url;
    if (url.startsWith('/api/') && !url.startsWith('/api/docs')) {
      const parts = url.replace('/api/', '').split('/');
      const tag = parts[0] || 'other';
      if (!routeOptions.schema) {
        routeOptions.schema = {};
      }
      // schema 可能已被 Object.freeze() 冻结（如 Fastify 编译优化后），无法直接修改，
      // 此时创建一个新对象并拷贝已有属性
      if (Object.isFrozen(routeOptions.schema)) {
        routeOptions.schema = { ...routeOptions.schema };
      }
      if (!routeOptions.schema.tags) {
        routeOptions.schema.tags = [tag];
      }
    }
  });

  // ==================== JWT Bearer 认证 (Phase 5c, 替代旧的 Cookie Session authPlugin) ====================

  if (options.enableAuth) {
    await authMiddleware(app, { db });
    await authRoutes(app, db);
    await adminRoutes(app, db);
    await superAdminRoutes(app, db);

    // Phase 5d: Ops scheduler + routes
    const scheduler = new OpsScheduler();
    scheduler.start(db);
    app.decorate('opsScheduler', scheduler);
    await opsRoutes(app, db, scheduler);

    // Graceful shutdown for scheduler
    app.addHook('onClose', async () => {
      scheduler.stop();
    });

    // Try to create super admin on startup
    try {
      const result = await ensureSuperAdmin(db);
      if (result) {
        console.log('========================================');
        console.log('🔑 超级管理员账号已创建');
        console.log(`   邮箱: ${result.email}`);
        console.log(`   密码: ${result.password}`);
        console.log('   首次登录后请立即修改！');
        console.log('========================================');
      }
    } catch (e) {
      // Super admin creation may fail in SQLite mode - that's OK
    }
  }

  // ==================== Swagger Docs（必须在路由之前注册才能捕获到路由） ====================

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PapaCheck API',
        description: 'PapaCheck（爸~检查！）Node.js 服务器 API',
        version: '1.0.0',
      },
      tags: [
        { name: 'homeworks', description: '作业管理' },
        { name: 'settlement', description: '日结/评级' },
        { name: 'shop', description: '积分商店' },
        { name: 'redemptions', description: '兑换记录' },
        { name: 'reward-box', description: '奖励箱' },
        { name: 'settings', description: '系统设置' },
        { name: 'active-buffs', description: '活跃 Buff' },
        { name: 'efficiency', description: '效率统计' },
        { name: 'freetime', description: '自由时间' },
        { name: 'bounty-tasks', description: '赏金任务' },
        { name: 'bounty-submissions', description: '赏金提交' },
        { name: 'bounty-completions', description: '赏金完成' },
        { name: 'defer-homework', description: '作业延后' },
        { name: 'email', description: '邮件同步' },
        { name: 'sync', description: '数据同步' },
        { name: 'data', description: '全量数据' },
        { name: 'points', description: '积分管理' },
        { name: 'reset-date', description: '日期重置' },
        { name: 'pregen-speech', description: '语音预生成' },
        { name: 'ping', description: '心跳/健康检查' },
        { name: 'version', description: '版本信息' },
        { name: 'speak', description: 'TTS 语音合成' },
        { name: 'crdt-pull', description: 'CRDT 同步' },
        { name: 'notifications', description: '通知管理' },
        { name: 'crdt-push', description: 'CRDT 推送' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
  });

  // ==================== GET Endpoints ====================

  // 1. GET /api/ping - 心跳（宽松限流，避免耗尽全局额度）
  app.get('/api/ping', { schema: pingSchema, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (_request, reply) => {
    return sendJson(reply, { ok: true, serverTime: new Date().toISOString() });
  });

  // 2. GET /api/version - 客户端版本号
  app.get('/api/version', { schema: versionSchema }, async (_request, reply) => {
    let clientVersion = '1.0.0';
    if (options.webDir) {
      try {
        const apkDir = join(options.webDir, 'apk');
        const apkDirStat = await stat(apkDir);
        if (!apkDirStat.isDirectory()) {
          return sendJson(reply, { clientVersion });
        }
        const files = await readdir(apkDir);
        const apkFiles = files
          .filter(f => f.startsWith('PapaCheck-') && f.endsWith('.apk'))
          .sort()
          .reverse();
        if (apkFiles.length > 0) {
          const match = apkFiles[0].match(/PapaCheck-(.+)\.apk/);
          if (match) {
            clientVersion = match[1];
          }
        }
      } catch (err) {
        console.error('[/api/version 错误]', err);
      }
    }
    return sendJson(reply, { clientVersion });
  });

  // 2a. GET /api/static-version - 静态文件版本 hash
  // ⚠️ 上云时：此路由需加内存缓存（启动算一次，每 60s 刷新），避免每次请求都读文件
  app.get('/api/static-version', { schema: staticVersionSchema }, async (_request, reply) => {
    let version = '';
    if (options.webDir) {
      const files = [
        'index.html', 'admin.html', 'sw.js', 'favicon.png',
        'css/style.css', 'css/admin.css',
        'js/api.js', 'js/connection.js', 'js/app.js', 'js/big-screen.js',
        'js/admin.js', 'js/await await await await db.js', 'js/change-log.js', 'js/crdt-sync.js', 'js/sync.js',
      ];
      const hash = createHash('sha1');
      for (const f of files) {
        try {
          const content = await readFile(join(options.webDir, f));
          hash.update(content);
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.error(`[static-version] 读取文件 ${f} 出错:`, err);
          }
        }
      }
      version = hash.digest('hex').slice(0, 12);
    }
    return sendJson(reply, { version });
  });

  // 2b. GET /api/download - 下载最新 APK
  app.get('/api/download', async (_request, reply) => {
    if (!options.webDir) {
      return reply.status(404).send({ error: 'APK not found', code: ErrorCodes.NOT_FOUND });
    }
    const apkDir = join(options.webDir, 'apk');
    try {
      const apkDirStat = await stat(apkDir);
      if (!apkDirStat.isDirectory()) {
        return reply.status(404).send({ error: 'APK not found', code: ErrorCodes.NOT_FOUND });
      }
      const files = await readdir(apkDir);
      const apkFiles = files
        .filter(f => f.startsWith('PapaCheck-') && f.endsWith('.apk'))
        .sort()
        .reverse();
      if (apkFiles.length === 0) {
        return reply.status(404).send({ error: 'APK not found', code: ErrorCodes.NOT_FOUND });
      }
      const apkName = apkFiles[0];
      const apkPath = join(apkDir, apkName);
      const apkStat = await stat(apkPath);
      reply.header('Content-Type', 'application/vnd.android.package-archive');
      reply.header('Content-Length', apkStat.size);
      reply.header('Content-Disposition', `attachment; filename="${apkName}"`);
      return reply.send(createReadStream(apkPath));
    } catch (err) {
      console.error('[/api/download 错误]', err);
      return reply.status(404).send({ error: 'APK not found', code: ErrorCodes.NOT_FOUND });
    }
  });

  // 3. GET /api/data - 完整数据
  app.get('/api/data', { schema: dataSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getFullData(tenantId));
  });

  // 4. GET /api/homeworks/:date
  app.get<{ Params: { date: string } }>('/api/homeworks/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getHomeworks(request.params.date, tenantId));
  });

  // 5. GET /api/settlement/:date
  app.get<{ Params: { date: string } }>('/api/settlement/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getSettlement(request.params.date, tenantId));
  });

  // 6. GET /api/shop
  app.get('/api/shop', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getShopItems(tenantId));
  });

  // 7. GET /api/redemptions
  app.get('/api/redemptions', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getRedemptions(tenantId));
  });

  // 8. GET /api/reward-box
  app.get('/api/reward-box', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getRewardBox(tenantId));
  });

  // 9. GET /api/settings
  app.get('/api/settings', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getSettings(tenantId));
  });

  // 10. GET /api/active-buffs
  app.get('/api/active-buffs', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getActiveBuffs(tenantId));
  });

  // 11. GET /api/efficiency/:date
  app.get<{ Params: { date: string } }>('/api/efficiency/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getEfficiency(request.params.date, tenantId));
  });

  // 12. GET /api/freetime/:date
  app.get<{ Params: { date: string } }>('/api/freetime/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getFreeTime(request.params.date, tenantId));
  });

  // 13. GET /api/bounty-tasks
  app.get('/api/bounty-tasks', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getBountyTasks(tenantId));
  });

  // 14. GET /api/bounty-submissions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-submissions/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getBountySubmissions(request.params.date, tenantId));
  });

  // 15. GET /api/bounty-completions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-completions/:date', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    return sendJson(reply, await db.getBountyCompletions(request.params.date, tenantId));
  });

  // 16. GET /api/sync/pull - 同步拉取
  app.get('/api/sync/pull', async (request: any, reply) => {
    const query = request.query as { lastSync?: string };
    const lastSync = query.lastSync || '1970-01-01T00:00:00+00:00';
    const tenantId = request.jwtPayload?.tenant_id;
    const changes = await db.getModifiedSince(lastSync, tenantId);
    return sendJson(reply, { changes, serverTime: new Date().toISOString() });
  });

  // 17. GET /api/speak - TTS 语音合成
  app.get('/api/speak', async (request, reply) => {
    const query = request.query as { text?: string };
    const text = query.text || '';
    if (!text) {
      return reply.status(400).send({ error: 'Missing text' });
    }
    const mp3Data = await tts.speak(text);
    if (mp3Data.length === 0) {
      const lastError = tts.getLastError() || 'TTS 返回空数据';
      return reply.status(500).send({ error: lastError, code: 'TTS_EMPTY' });
    }
    reply.header('Content-Type', 'audio/mpeg');
    reply.header('Content-Length', mp3Data.length);
    return reply.send(mp3Data);
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
    await db.saveHomeworks(dateKey, body.homeworks, tenantId);
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
    // 同时兼容 { settlement: data } 和直接 data 两种 payload 格式
    await db.saveSettlement(request.params.date, body.settlement ?? body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 21. PATCH /api/points - 更新积分
  app.patch('/api/points', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    if (body.action) {
      if (body.action !== 'earn' && body.action !== 'spend') {
        return reply.status(400).send({ error: 'action 必须是 earn 或 spend' });
      }
      // 全量替换风格（原 POST /api/points）
      const balance = await db.updatePoints(body.action, body.amount, body.detail, tenantId);
      return sendJson(reply, { ok: true, balance });
    }
    // 增量更新风格（原 PATCH /api/points）
    const balance = await db.patchPoints(body, tenantId);
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
    await db.saveRedemptions(body.redemptions, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 23b. DELETE /api/redemptions/fulfilled — 清空已兑现记录
  app.delete('/api/redemptions/fulfilled', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.clearFulfilledRedemptions(tenantId);
    return sendJson(reply, { ok: true });
  });

  // 24. PUT /api/reward-box
  app.put('/api/reward-box', async (request: any, reply) => {
    const body = request.body as { items: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    await db.saveRewardBox(body.items, tenantId);
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
    await db.saveActiveBuffs(body.buffs, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 27. PUT /api/efficiency/:date — 全量替换效率数据
  app.put<{ Params: { date: string } }>('/api/efficiency/:date', async (request: any, reply) => {
    const body = request.body as any;
    const tenantId = request.jwtPayload?.tenant_id;
    // 同时兼容 { efficiency: data } 和直接 data 两种 payload 格式
    await db.saveEfficiency(request.params.date, body.efficiency ?? body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 28. PUT /api/freetime — 全量替换自由时间（body 含 dateKey + tasks）
  app.put('/api/freetime', async (request: any, reply) => {
    const body = request.body as { dateKey?: string; tasks: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    await db.saveFreeTime(body.dateKey, body.tasks, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 28b. PUT /api/freetime/:id — 单条自由时间 upsert
  app.put<{ Params: { id: string } }>('/api/freetime/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putFreeTimeTask(request.params.id, request.body, tenantId);
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
    await db.saveBountySubmissions(body.dateKey, body.submissions, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 30b. PUT /api/bounty-submissions/:id — 单条赏金提交 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-submissions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putBountySubmission(request.params.id, request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 31. PUT /api/bounty-completions — 全量替换赏金完成（body 含 dateKey + completions）
  app.put('/api/bounty-completions', async (request: any, reply) => {
    const body = request.body as { dateKey?: string; completions: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    await db.saveBountyCompletions(body.dateKey, body.completions, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 31b. PUT /api/bounty-completions/:id — 单条赏金完成 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-completions/:id', { schema: idParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.putBountyCompletion(request.params.id, request.body, tenantId);
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

    if (action === 'request') {
      const homeworks = await db.getHomeworks(date, tenantId);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found && found.status === 'pending' && !found.deferRequest) {
        found.deferRequest = {
          requestedAt: requestedAt || new Date().toISOString(),
          status: 'pending',
        };
        await db.saveHomeworks(date, homeworks, tenantId);
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'approve') {
      const homeworks = await db.getHomeworks(date, tenantId);
      const idx = homeworks.findIndex((h: any) => h.id === hwId);
      if (idx !== -1) {
        const hw = { ...homeworks[idx] };
        delete hw.deferRequest;
        hw.status = 'pending';

        // 从当前日期移除
        homeworks.splice(idx, 1);
        await db.saveHomeworks(date, homeworks, tenantId);

        // 添加到次日
        const tomorrow = getTomorrow(date);
        hw.date = tomorrow;
        const tomorrowHw = await db.getHomeworks(tomorrow, tenantId);
        tomorrowHw.push(hw);
        await db.saveHomeworks(tomorrow, tomorrowHw, tenantId);

        return sendJson(reply, { ok: true, homework: hw });
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'reject') {
      const homeworks = await db.getHomeworks(date, tenantId);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found) {
        delete found.deferRequest;
        await db.saveHomeworks(date, homeworks, tenantId);
      }
      return sendJson(reply, { ok: true });
    }

    return sendJson(reply, { ok: true });
  });

  // 33. POST /api/reset-date - 重置日期数据
  app.post('/api/reset-date', async (request: any, reply) => {
    const body = request.body as { date: string };
    const tenantId = request.jwtPayload?.tenant_id;
    await db.resetDate(body.date, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 34. POST /api/sync/push - 同步推送
  app.post('/api/sync/push', async (request: any, reply) => {
    const body = request.body as { changes: unknown[] };
    const tenantId = request.jwtPayload?.tenant_id;
    const result = await db.pushMerge(body.changes, tenantId);
    return sendJson(reply, result);
  });

  // 35. POST /api/pregen-speech - 预生成语音（后台执行）
  app.post('/api/pregen-speech', async (request, reply) => {
    const body = request.body as { texts: string[] };
    if (body.texts && body.texts.length > 0) {
      tts.pregenSpeech(body.texts);
    }
    return sendJson(reply, { ok: true });
  });

  // 36. POST /api/email/config - 保存邮箱配置
  app.post('/api/email/config', async (request: any, reply) => {
    const body = request.body as {
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      apiKey?: string;
      apiUrl?: string;
      markAsRead?: boolean;
      attachmentDir?: string;
    };

    if (!body.host || !body.port || !body.user || !body.password) {
      return reply.status(400).send({
        error: '请填写完整的 IMAP 配置（host, port, user, password）',
        code: 'VALIDATION_ERROR',
      });
    }

    const tenantId = request.jwtPayload?.tenant_id;
    await db.saveEmailConfig(body, tenantId);
    return sendJson(reply, { ok: true });
  });

  /**
   * 展开 AI 可能合并的多条作业内容
   * 如 "1. 测试语文 1\n2. 测试语文 2" → [{ subject: '语文', content: '测试语文 1' }, { subject: '语文', content: '测试语文 2' }]
   */
  function expandHomeworkContent(hw: HomeworkItem): HomeworkItem[] {
    const items: HomeworkItem[] = [];

    // 检查 content 中是否有编号列表（如 "1. X\n2. Y"）
    const lines = hw.content.split('\n').filter((l) => l.trim());
    const numberedLines = lines.filter((l) => /^\s*\d+[.、]/.test(l.trim()));

    if (numberedLines.length >= 2) {
      // 有多条编号项 → 拆分为独立作业
      for (const line of numberedLines) {
        const text = line.replace(/^\s*\d+[.、]\s*/, '').trim();
        if (text) {
          items.push({
            subject: hw.subject,
            content: text,
            date: hw.date,
          });
        }
      }
    } else {
      // 单条内容，保持原样
      items.push(hw);
    }

    return items;
  }

  // 37. POST /api/email/sync - 触发邮件同步
  app.post('/api/email/sync', async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    const config = await db.getEmailConfig(tenantId);

    if (!config) {
      return reply.status(400).send({
        error: '请先配置邮箱',
        code: 'EMAIL_CONFIG_MISSING',
      });
    }

    if (!config.apiKey || !config.apiUrl) {
      return reply.status(400).send({
        error: '请配置 AI API Key 和 API URL',
        code: 'AI_CONFIG_MISSING',
      });
    }

    const syncer = new EmailSync(config);
    const result = await syncer.sync();

    if (!result.ok) {
      return reply.status(500).send({
        error: result.error || '邮件同步失败',
        code: 'EMAIL_SYNC_ERROR',
      });
    }

    // 保存解析出的作业
    const expanded: HomeworkItem[] = [];
    if (result.homeworks && result.homeworks.length > 0) {
      // 展开 AI 可能合并的多条内容（如 "1. 语文\n2. 数学" → 两条独立作业）
      for (const hw of result.homeworks) {
        const items = expandHomeworkContent(hw);
        expanded.push(...items);
      }

      // 先收集所有要插入的作业，统一生成 ID，避免插入过程中出错后部分残留
      const insertedIds: string[] = [];
      try {
        for (const hw of expanded) {
          const dateKey = hw.date || new Date().toISOString().slice(0, 10);
          const hwId = `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await db.putHomework(hwId, {
            id: hwId,
            subject: hw.subject,
            content: hw.content,
            dateKey,
            status: 'pending',
            source: 'email',
            suggestedDuration: hw.suggestedDuration ?? 20,
            basePoints: hw.basePoints ?? 10,
            mode: 'pending',
            actualDuration: null,
          }, tenantId);
          insertedIds.push(hwId);
        }
      } catch (err) {
        console.error('[email/sync] 插入作业时出错，已插入 %d 条，尝试回滚...', insertedIds.length, err);
        // 尝试删除已插入的作业（幂等回滚）
        for (const id of insertedIds) {
          try { await db.deleteHomework(id, tenantId); } catch { /* 忽略单个删除失败 */ }
        }
        return reply.status(500).send({
          error: '邮件同步插入作业失败，已回滚',
          code: 'EMAIL_SYNC_INSERT_ERROR',
        });
      }

      // 添加通知：有新作业来自云端
      await db.addNotification('收到云端作业，请查看', undefined, tenantId);
    }

    return sendJson(reply, { ok: true, homeworks: expanded || [], hasAttachments: result.hasAttachments ?? false });
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

  // CRDT 同步推送
  app.post('/api/sync/crdt-push', async (request: any, reply) => {
    const body = request.body as { operations: CRDTOperation[] };
    if (!body.operations || !Array.isArray(body.operations)) {
      return reply.status(400).send({ error: '缺少 operations 数组', code: 'VALIDATION_ERROR' });
    }
    const tenantId = request.jwtPayload?.tenant_id;
    for (const op of body.operations) {
      await db.saveCRDTOperation(op, tenantId);
      await db.applyCRDTOperation(op, tenantId);
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
    await db.putHomework(request.params.id, request.body, tenantId);
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
    // 检查同一 rewardBoxItemId 是否已有 pending 兑换（服务端兜底）
    if (data && data.fromRewardBox && data.status === 'pending' && data.rewardBoxItemId) {
      const redemptions = await db.getRedemptions(tenantId);
      const existing = redemptions.find((r: any) =>
        r.rewardBoxItemId === data.rewardBoxItemId &&
        r.status === 'pending' &&
        r.id !== request.params.id
      );
      if (existing) {
        return reply.code(409).send({ ok: false, error: 'duplicate_pending_redemption', message: '该物品已有待处理兑换申请' });
      }
    }
    await db.putRedemption(request.params.id, request.body, tenantId);
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
    await db.patchHomework(request.params.id, request.body, tenantId);
    return sendJson(reply, { ok: true });
  });

  // 48. PATCH /api/settlement/:date
  app.patch<{ Params: { date: string } }>('/api/settlement/:date', { schema: dateParamSchema }, async (request: any, reply) => {
    const tenantId = request.jwtPayload?.tenant_id;
    await db.patchSettlement(request.params.date, request.body, tenantId);
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
    await db.deleteHomework(request.params.id, tenantId);
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

  // ==================== 语义化路由 ====================

  // GET /child - 孩子端大屏
  app.get('/child', async (_request, reply) => {
    const indexPath = join(options.webDir, 'index.html');
    try {
      await stat(indexPath);
      return reply.type('text/html; charset=utf-8').send(createReadStream(indexPath));
    } catch {
      return reply.status(404).send({ error: 'File not found', code: ErrorCodes.NOT_FOUND });
    }
  });

  // GET /parent - 家长管理端
  app.get('/parent', async (_request, reply) => {
    const adminPath = join(options.webDir, 'admin.html');
    try {
      await stat(adminPath);
      return reply.type('text/html; charset=utf-8').send(createReadStream(adminPath));
    } catch {
      return reply.status(404).send({ error: 'File not found', code: ErrorCodes.NOT_FOUND });
    }
  });

  // GET /login - 统一登录页
  app.get('/login', async (_request, reply) => {
    const loginPath = join(options.webDir, 'login.html');
    try {
      await stat(loginPath);
      return reply.type('text/html; charset=utf-8').send(createReadStream(loginPath));
    } catch {
      return reply.status(404).send({ error: 'File not found', code: ErrorCodes.NOT_FOUND });
    }
  });

  // ==================== Static Files ====================

  if (options.webDir) {
    await app.register(fastifyStatic, {
      root: options.webDir,
      prefix: '/',
      cacheControl: false,
      etag: false,
      lastModified: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      },
    });
  }

  // 启动时后台预生成固定短语（不阻塞启动）
  tts.pregenAllFixed().catch(() => { });

  // ==================== Graceful Shutdown ====================

  app.addHook('onClose', async (_instance) => {
    await db.close();
    tts.stop();
  });

  return app;
}
