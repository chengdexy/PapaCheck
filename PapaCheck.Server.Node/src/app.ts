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
import cookie from '@fastify/cookie';
import { AppError, ErrorCodes } from './errors.js';
import type { CRDTOperation } from './crdt/types.js';
import { authPlugin } from './auth-plugin.js';

export interface AppOptions {
  port: number;
  webDir: string;
  dbPath: string;
  ttsPython?: string;
  showPollingLog?: boolean;
  /** 启用 Cookie Session 临时认证（生产环境设为 true） */
  enableAuth?: boolean;
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
  });

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

  // ==================== Cookie 解析 & 临时认证 ====================

  if (options.enableAuth) {
    await app.register(cookie);
    await authPlugin(app, db);
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

  // 1. GET /api/ping - 心跳
  app.get('/api/ping', { schema: pingSchema }, async (_request, reply) => {
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
  app.get('/api/data', { schema: dataSchema }, async (_request, reply) => {
    return sendJson(reply, await await await await db.getFullData());
  });

  // 4. GET /api/homeworks/:date
  app.get<{ Params: { date: string } }>('/api/homeworks/:date', async (request, reply) => {
    return sendJson(reply, await await await await db.getHomeworks(request.params.date));
  });

  // 5. GET /api/settlement/:date
  app.get<{ Params: { date: string } }>('/api/settlement/:date', async (request, reply) => {
    return sendJson(reply, await await await await db.getSettlement(request.params.date));
  });

  // 6. GET /api/shop
  app.get('/api/shop', async (_request, reply) => {
    return sendJson(reply, await await await await db.getShopItems());
  });

  // 7. GET /api/redemptions
  app.get('/api/redemptions', async (_request, reply) => {
    return sendJson(reply, await await await await db.getRedemptions());
  });

  // 8. GET /api/reward-box
  app.get('/api/reward-box', async (_request, reply) => {
    return sendJson(reply, await await await await db.getRewardBox());
  });

  // 9. GET /api/settings
  app.get('/api/settings', async (_request, reply) => {
    return sendJson(reply, await await await await db.getSettings());
  });

  // 10. GET /api/active-buffs
  app.get('/api/active-buffs', async (_request, reply) => {
    return sendJson(reply, await await await await db.getActiveBuffs());
  });

  // 11. GET /api/efficiency/:date
  app.get<{ Params: { date: string } }>('/api/efficiency/:date', async (request, reply) => {
    return sendJson(reply, await await await await db.getEfficiency(request.params.date));
  });

  // 12. GET /api/freetime/:date
  app.get<{ Params: { date: string } }>('/api/freetime/:date', async (request, reply) => {
    return sendJson(reply, await await await await db.getFreeTime(request.params.date));
  });

  // 13. GET /api/bounty-tasks
  app.get('/api/bounty-tasks', async (_request, reply) => {
    return sendJson(reply, await await await await db.getBountyTasks());
  });

  // 14. GET /api/bounty-submissions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-submissions/:date', async (request, reply) => {
    return sendJson(reply, await await await await db.getBountySubmissions(request.params.date));
  });

  // 15. GET /api/bounty-completions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-completions/:date', async (request, reply) => {
    return sendJson(reply, await await await await db.getBountyCompletions(request.params.date));
  });

  // 16. GET /api/sync/pull - 同步拉取
  app.get('/api/sync/pull', async (request, reply) => {
    const query = request.query as { lastSync?: string };
    const lastSync = query.lastSync || '1970-01-01T00:00:00+00:00';
    const changes = await await await await db.getModifiedSince(lastSync);
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
  app.post('/api/data', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: '请求体必须是 JSON 对象' });
    }
    // 估算大小：序列化后超过 10MB 拒绝
    const raw = JSON.stringify(body);
    if (raw.length > 10 * 1024 * 1024) {
      return reply.status(413).send({ error: '数据过大，最大允许 10MB' });
    }
    await await await await db.importFullData(body);
    return sendJson(reply, { ok: true });
  });

  // 19. PUT /api/homeworks — 全量替换当日作业列表（body 含 dateKey + homeworks）
  app.put('/api/homeworks', async (request, reply) => {
    const body = request.body as { dateKey?: string; homeworks: unknown[] };
    const dateKey = body.dateKey;
    if (!dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    await await await await db.saveHomeworks(dateKey, body.homeworks);
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
  app.put<{ Params: { date: string } }>('/api/settlement/:date', async (request, reply) => {
    const body = request.body as any;
    // 同时兼容 { settlement: data } 和直接 data 两种 payload 格式
    await await await await db.saveSettlement(request.params.date, body.settlement ?? body);
    return sendJson(reply, { ok: true });
  });

  // 21. PATCH /api/points - 更新积分
  app.patch('/api/points', async (request, reply) => {
    const body = request.body as any;
    if (body.action) {
      if (body.action !== 'earn' && body.action !== 'spend') {
        return reply.status(400).send({ error: 'action 必须是 earn 或 spend' });
      }
      // 全量替换风格（原 POST /api/points）
      const balance = await await await await db.updatePoints(body.action, body.amount, body.detail);
      return sendJson(reply, { ok: true, balance });
    }
    // 增量更新风格（原 PATCH /api/points）
    const balance = await await await await db.patchPoints(body);
    return sendJson(reply, { ok: true, balance });
  });

  // 22. PUT /api/shop
  app.put('/api/shop', async (request, reply) => {
    const body = request.body as { items: unknown[] };
    await await await await db.saveShopItems(body.items);
    return sendJson(reply, { ok: true });
  });

  // 23. PUT /api/redemptions
  app.put('/api/redemptions', async (request, reply) => {
    const body = request.body as { redemptions: unknown[] };
    await await await await db.saveRedemptions(body.redemptions);
    return sendJson(reply, { ok: true });
  });

  // 23b. DELETE /api/redemptions/fulfilled — 清空已兑现记录
  app.delete('/api/redemptions/fulfilled', async (_request, reply) => {
    await await await await db.clearFulfilledRedemptions();
    return sendJson(reply, { ok: true });
  });

  // 24. PUT /api/reward-box
  app.put('/api/reward-box', async (request, reply) => {
    const body = request.body as { items: unknown[] };
    await await await await db.saveRewardBox(body.items);
    return sendJson(reply, { ok: true });
  });

  // 25. PUT /api/settings — 全量替换设置
  app.put('/api/settings', async (request, reply) => {
    const body = request.body as any;
    // 同时兼容 { settings: data } 和直接 data 两种 payload 格式
    await await await await db.saveSettings(body.settings ?? body);
    return sendJson(reply, { ok: true });
  });

  // 26. PUT /api/active-buffs
  app.put('/api/active-buffs', async (request, reply) => {
    const body = request.body as { buffs: unknown[] };
    await await await await db.saveActiveBuffs(body.buffs);
    return sendJson(reply, { ok: true });
  });

  // 27. PUT /api/efficiency/:date — 全量替换效率数据
  app.put<{ Params: { date: string } }>('/api/efficiency/:date', async (request, reply) => {
    const body = request.body as any;
    // 同时兼容 { efficiency: data } 和直接 data 两种 payload 格式
    await await await await db.saveEfficiency(request.params.date, body.efficiency ?? body);
    return sendJson(reply, { ok: true });
  });

  // 28. PUT /api/freetime — 全量替换自由时间（body 含 dateKey + tasks）
  app.put('/api/freetime', async (request, reply) => {
    const body = request.body as { dateKey?: string; tasks: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    await await await await db.saveFreeTime(body.dateKey, body.tasks);
    return sendJson(reply, { ok: true });
  });

  // 28b. PUT /api/freetime/:id — 单条自由时间 upsert
  app.put<{ Params: { id: string } }>('/api/freetime/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putFreeTimeTask(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 29. PUT /api/bounty-tasks
  app.put('/api/bounty-tasks', async (request, reply) => {
    const body = request.body as { items: unknown[] };
    await await await await db.saveBountyTasks(body.items);
    return sendJson(reply, { ok: true });
  });

  // 30. PUT /api/bounty-submissions — 全量替换赏金提交（body 含 dateKey + submissions）
  app.put('/api/bounty-submissions', async (request, reply) => {
    const body = request.body as { dateKey?: string; submissions: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    await await await await db.saveBountySubmissions(body.dateKey, body.submissions);
    return sendJson(reply, { ok: true });
  });

  // 30b. PUT /api/bounty-submissions/:id — 单条赏金提交 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-submissions/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putBountySubmission(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 31. PUT /api/bounty-completions — 全量替换赏金完成（body 含 dateKey + completions）
  app.put('/api/bounty-completions', async (request, reply) => {
    const body = request.body as { dateKey?: string; completions: unknown[] };
    if (!body.dateKey) {
      return reply.status(400).send({ error: '缺少 dateKey' });
    }
    await await await await db.saveBountyCompletions(body.dateKey, body.completions);
    return sendJson(reply, { ok: true });
  });

  // 31b. PUT /api/bounty-completions/:id — 单条赏金完成 upsert
  app.put<{ Params: { id: string } }>('/api/bounty-completions/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putBountyCompletion(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 32. POST /api/defer-homework - 延迟作业（请求/批准/拒绝）
  app.post('/api/defer-homework', async (request, reply) => {
    const body = request.body as {
      date: string;
      hwId: string;
      action: 'request' | 'approve' | 'reject';
      requestedAt?: string;
    };
    const { date, hwId, action, requestedAt } = body;

    if (action === 'request') {
      const homeworks = await await await await db.getHomeworks(date);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found && found.status === 'pending' && !found.deferRequest) {
        found.deferRequest = {
          requestedAt: requestedAt || new Date().toISOString(),
          status: 'pending',
        };
        await await await await db.saveHomeworks(date, homeworks);
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'approve') {
      const homeworks = await await await await db.getHomeworks(date);
      const idx = homeworks.findIndex((h: any) => h.id === hwId);
      if (idx !== -1) {
        const hw = { ...homeworks[idx] };
        delete hw.deferRequest;
        hw.status = 'pending';

        // 从当前日期移除
        homeworks.splice(idx, 1);
        await await await await db.saveHomeworks(date, homeworks);

        // 添加到次日
        const tomorrow = getTomorrow(date);
        hw.date = tomorrow;
        const tomorrowHw = await await await await db.getHomeworks(tomorrow);
        tomorrowHw.push(hw);
        await await await await db.saveHomeworks(tomorrow, tomorrowHw);

        return sendJson(reply, { ok: true, homework: hw });
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'reject') {
      const homeworks = await await await await db.getHomeworks(date);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found) {
        delete found.deferRequest;
        await await await await db.saveHomeworks(date, homeworks);
      }
      return sendJson(reply, { ok: true });
    }

    return sendJson(reply, { ok: true });
  });

  // 33. POST /api/reset-date - 重置日期数据
  app.post('/api/reset-date', async (request, reply) => {
    const body = request.body as { date: string };
    await await await await db.resetDate(body.date);
    return sendJson(reply, { ok: true });
  });

  // 34. POST /api/sync/push - 同步推送
  app.post('/api/sync/push', async (request, reply) => {
    const body = request.body as { changes: unknown[] };
    const result = await await await await db.pushMerge(body.changes);
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
  app.post('/api/email/config', async (request, reply) => {
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

    await await await await db.saveEmailConfig(body);
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
  app.post('/api/email/sync', async (request, reply) => {
    const config = await await await await db.getEmailConfig();

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
          await await await await db.putHomework(hwId, {
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
          });
          insertedIds.push(hwId);
        }
      } catch (err) {
        console.error('[email/sync] 插入作业时出错，已插入 %d 条，尝试回滚...', insertedIds.length, err);
        // 尝试删除已插入的作业（幂等回滚）
        for (const id of insertedIds) {
          try { await await await await db.deleteHomework(id); } catch { /* 忽略单个删除失败 */ }
        }
        return reply.status(500).send({
          error: '邮件同步插入作业失败，已回滚',
          code: 'EMAIL_SYNC_INSERT_ERROR',
        });
      }

      // 添加通知：有新作业来自云端
      await await await await db.addNotification('收到云端作业，请查看');
    }

    return sendJson(reply, { ok: true, homeworks: expanded || [], hasAttachments: result.hasAttachments ?? false });
  });

  // 通知：创建通知
  app.post('/api/notify', async (request, reply) => {
    const body = request.body as { text?: string };
    if (!body.text || !body.text.trim()) {
      return reply.status(400).send({
        error: '通知内容不能为空',
        code: 'VALIDATION_ERROR',
      });
    }
    const id = await await await await db.addNotification(body.text.trim());
    return sendJson(reply, { ok: true, id });
  });

  // 通知：拉取待消费通知（自动清理过期）
  app.get('/api/notify/pending', async (_request, reply) => {
    const items = await await await await db.getPendingNotifications();
    return sendJson(reply, { items });
  });

  // 通知：消费通知
  app.delete('/api/notify/consumed', async (request, reply) => {
    const query = request.query as { ids?: string };
    if (query.ids) {
      const ids = query.ids.split(',').filter(Boolean);
      if (ids.length > 0) {
        await await await await db.consumeNotifications(ids);
      }
    }
    return sendJson(reply, { ok: true });
  });

  // CRDT 同步推送
  app.post('/api/sync/crdt-push', async (request, reply) => {
    const body = request.body as { operations: CRDTOperation[] };
    if (!body.operations || !Array.isArray(body.operations)) {
      return reply.status(400).send({ error: '缺少 operations 数组', code: 'VALIDATION_ERROR' });
    }
    for (const op of body.operations) {
      await await await await db.saveCRDTOperation(op);
      await await await await db.applyCRDTOperation(op);
    }
    return sendJson(reply, { ok: true });
  });

  // CRDT 增量拉取
  app.get('/api/sync/crdt-pull', async (request, reply) => {
    const query = request.query as { since?: string };
    const since = query.since || '1970-01-01T00:00:00Z';
    const operations = await await await await db.getCRDTOperationsSince(since);
    return sendJson(reply, { operations });
  });

  // CRDT 确认消费
  app.delete('/api/sync/crdt-pull', async (request, reply) => {
    const query = request.query as { ack?: string };
    if (query.ack) {
      await await await await db.ackCRDTOperations(query.ack);
    }
    return sendJson(reply, { ok: true });
  });

  // ==================== PUT Endpoints（单资源 upsert） ====================

  // 35. PUT /api/homeworks/:id
  app.put<{ Params: { id: string } }>('/api/homeworks/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putHomework(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 37. PUT /api/shop/:id
  app.put<{ Params: { id: string } }>('/api/shop/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putShopItem(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 38. PUT /api/redemptions/:id
  app.put<{ Params: { id: string } }>('/api/redemptions/:id', { schema: idParamSchema }, async (request, reply) => {
    const data = request.body as any;
    // 检查同一 rewardBoxItemId 是否已有 pending 兑换（服务端兜底）
    if (data && data.fromRewardBox && data.status === 'pending' && data.rewardBoxItemId) {
      const redemptions = await db.getRedemptions();
      const existing = redemptions.find((r: any) =>
        r.rewardBoxItemId === data.rewardBoxItemId &&
        r.status === 'pending' &&
        r.id !== request.params.id
      );
      if (existing) {
        return reply.code(409).send({ ok: false, error: 'duplicate_pending_redemption', message: '该物品已有待处理兑换申请' });
      }
    }
    await db.putRedemption(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 39. PUT /api/reward-box/:id
  app.put<{ Params: { id: string } }>('/api/reward-box/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putRewardBoxItem(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 40. DELETE /api/reward-box/:id
  app.delete<{ Params: { id: string } }>('/api/reward-box/:id', { schema: deleteParamSchema }, async (request, reply) => {
    await await await await db.deleteRewardBoxItem(request.params.id);
    return sendJson(reply, { ok: true });
  });

  // 41. PUT /api/active-buffs/:id
  app.put<{ Params: { id: string } }>('/api/active-buffs/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putBuff(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 44. PUT /api/bounty-tasks/:id
  app.put<{ Params: { id: string } }>('/api/bounty-tasks/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.putBountyTask(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // ==================== PATCH Endpoints ====================

  // 47. PATCH /api/homeworks/:id
  app.patch<{ Params: { id: string } }>('/api/homeworks/:id', { schema: idParamSchema }, async (request, reply) => {
    await await await await db.patchHomework(request.params.id, request.body);
    return sendJson(reply, { ok: true });
  });

  // 48. PATCH /api/settlement/:date
  app.patch<{ Params: { date: string } }>('/api/settlement/:date', { schema: dateParamSchema }, async (request, reply) => {
    await await await await db.patchSettlement(request.params.date, request.body);
    return sendJson(reply, { ok: true });
  });

  // 50. PATCH /api/settings
  app.patch('/api/settings', { schema: { body: { type: 'object' } } }, async (request, reply) => {
    await await await await db.patchSettings(request.body);
    return sendJson(reply, { ok: true });
  });

  // ==================== DELETE Endpoints ====================

  // 51. DELETE /api/homeworks/:id
  app.delete<{ Params: { id: string } }>('/api/homeworks/:id', { schema: deleteParamSchema }, async (request, reply) => {
    await await await await db.deleteHomework(request.params.id);
    return sendJson(reply, { ok: true });
  });

  // 52. DELETE /api/shop/:id
  app.delete<{ Params: { id: string } }>('/api/shop/:id', { schema: deleteParamSchema }, async (request, reply) => {
    await await await await db.deleteShopItem(request.params.id);
    return sendJson(reply, { ok: true });
  });

  // 53. DELETE /api/active-buffs/:id
  app.delete<{ Params: { id: string } }>('/api/active-buffs/:id', { schema: deleteParamSchema }, async (request, reply) => {
    await await await await db.deleteBuff(request.params.id);
    return sendJson(reply, { ok: true });
  });

  // 54. DELETE /api/bounty-tasks/:id
  app.delete<{ Params: { id: string } }>('/api/bounty-tasks/:id', { schema: deleteParamSchema }, async (request, reply) => {
    await await await await db.deleteBountyTask(request.params.id);
    return sendJson(reply, { ok: true });
  });

  // ==================== HEAD Endpoints ====================

  // 55. HEAD /api/shop/:id
  app.head<{ Params: { id: string } }>('/api/shop/:id', { schema: { params: idParamSchema.params } }, async (request, reply) => {
    const item = await await await await db.getShopItemById(request.params.id);
    if (!item) {
      return reply.status(404).send();
    }
    return reply.status(200).send();
  });

  // 56. HEAD /api/bounty-tasks/:id
  app.head<{ Params: { id: string } }>('/api/bounty-tasks/:id', { schema: { params: idParamSchema.params } }, async (request, reply) => {
    const item = await await await await db.getBountyTaskById(request.params.id);
    if (!item) {
      return reply.status(404).send();
    }
    return reply.status(200).send();
  });

  // HEAD /api/homeworks/:id 由 Fastify 从 GET /api/homeworks/:date 自动生成
  // 由于该路由按日期查询返回数组，HEAD 始终返回 200（含空数组），不做存在性检查

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
    await await await await db.close();
    tts.stop();
  });

  return app;
}
