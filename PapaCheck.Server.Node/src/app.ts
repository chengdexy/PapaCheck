import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { PapaCheckDB } from './db/index.js';
import { TTSBridge } from './tts/index.js';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export interface AppOptions {
  port: number;
  webDir: string;
  dbPath: string;
  ttsPython?: string;
  showPollingLog?: boolean;
}

/** 设置 Content-Type: application/json; charset=utf-8 并返回数据 */
function sendJson(reply: FastifyReply, data: unknown): unknown {
  reply.header('Content-Type', 'application/json; charset=utf-8');
  return data;
}

/** 计算指定日期的下一天（YYYY-MM-DD） */
function getTomorrow(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  // 创建数据库和 TTS 实例
  const db = new PapaCheckDB(options.dbPath);
  const tts = new TTSBridge({
    pythonPath: options.ttsPython ?? 'python',
  });

  // 暴露给测试使用
  app.decorate('papaCheckDB', db);
  app.decorate('tts', tts);

  // ==================== CORS ====================

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }
  });

  // ==================== GET Endpoints ====================

  // 1. GET /api/ping - 心跳
  app.get('/api/ping', async (_request, reply) => {
    return sendJson(reply, { ok: true, serverTime: new Date().toISOString() });
  });

  // 2. GET /api/version - 客户端版本号
  app.get('/api/version', async (_request, reply) => {
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

  // 3. GET /api/data - 完整数据
  app.get('/api/data', async (_request, reply) => {
    return sendJson(reply, db.getFullData());
  });

  // 4. GET /api/homeworks/:date
  app.get<{ Params: { date: string } }>('/api/homeworks/:date', async (request, reply) => {
    return sendJson(reply, db.getHomeworks(request.params.date));
  });

  // 5. GET /api/settlement/:date
  app.get<{ Params: { date: string } }>('/api/settlement/:date', async (request, reply) => {
    return sendJson(reply, db.getSettlement(request.params.date));
  });

  // 6. GET /api/shop
  app.get('/api/shop', async (_request, reply) => {
    return sendJson(reply, db.getShopItems());
  });

  // 7. GET /api/redemptions
  app.get('/api/redemptions', async (_request, reply) => {
    return sendJson(reply, db.getRedemptions());
  });

  // 8. GET /api/reward-box
  app.get('/api/reward-box', async (_request, reply) => {
    return sendJson(reply, db.getRewardBox());
  });

  // 9. GET /api/settings
  app.get('/api/settings', async (_request, reply) => {
    return sendJson(reply, db.getSettings());
  });

  // 10. GET /api/active-buffs
  app.get('/api/active-buffs', async (_request, reply) => {
    return sendJson(reply, db.getActiveBuffs());
  });

  // 11. GET /api/efficiency/:date
  app.get<{ Params: { date: string } }>('/api/efficiency/:date', async (request, reply) => {
    return sendJson(reply, db.getEfficiency(request.params.date));
  });

  // 12. GET /api/freetime/:date
  app.get<{ Params: { date: string } }>('/api/freetime/:date', async (request, reply) => {
    return sendJson(reply, db.getFreeTime(request.params.date));
  });

  // 13. GET /api/bounty-tasks
  app.get('/api/bounty-tasks', async (_request, reply) => {
    return sendJson(reply, db.getBountyTasks());
  });

  // 14. GET /api/bounty-submissions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-submissions/:date', async (request, reply) => {
    return sendJson(reply, db.getBountySubmissions(request.params.date));
  });

  // 15. GET /api/bounty-completions/:date
  app.get<{ Params: { date: string } }>('/api/bounty-completions/:date', async (request, reply) => {
    return sendJson(reply, db.getBountyCompletions(request.params.date));
  });

  // 16. GET /api/sync/pull - 同步拉取
  app.get('/api/sync/pull', async (request, reply) => {
    const query = request.query as { lastSync?: string };
    const lastSync = query.lastSync || '1970-01-01T00:00:00+00:00';
    const changes = db.getModifiedSince(lastSync);
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
    reply.header('Content-Type', 'audio/mpeg');
    reply.header('Content-Length', mp3Data.length);
    return reply.send(mp3Data);
  });

  // ==================== POST Endpoints ====================

  // 17. POST /api/data - 导入完整数据
  app.post('/api/data', async (request, reply) => {
    db.importFullData(request.body);
    return sendJson(reply, { ok: true });
  });

  // 18. POST /api/homeworks/:date
  app.post<{ Params: { date: string } }>('/api/homeworks/:date', async (request, reply) => {
    const body = request.body as { homeworks: unknown[] };
    db.saveHomeworks(request.params.date, body.homeworks);
    return sendJson(reply, { ok: true });
  });

  // 19. POST /api/settlement/:date
  app.post<{ Params: { date: string } }>('/api/settlement/:date', async (request, reply) => {
    const body = request.body as { settlement: unknown };
    db.saveSettlement(request.params.date, body.settlement);
    return sendJson(reply, { ok: true });
  });

  // 20. POST /api/points - 更新积分
  app.post('/api/points', async (request, reply) => {
    const body = request.body as { action: 'earn' | 'spend'; amount: number; detail: string };
    const balance = db.updatePoints(body.action, body.amount, body.detail);
    return sendJson(reply, { ok: true, balance });
  });

  // 21. POST /api/shop
  app.post('/api/shop', async (request, reply) => {
    const body = request.body as { items: unknown[] };
    db.saveShopItems(body.items);
    return sendJson(reply, { ok: true });
  });

  // 22. POST /api/redemptions
  app.post('/api/redemptions', async (request, reply) => {
    const body = request.body as { redemptions: unknown[] };
    db.saveRedemptions(body.redemptions);
    return sendJson(reply, { ok: true });
  });

  // 23. POST /api/reward-box
  app.post('/api/reward-box', async (request, reply) => {
    const body = request.body as { items: unknown[] };
    db.saveRewardBox(body.items);
    return sendJson(reply, { ok: true });
  });

  // 24. POST /api/settings
  app.post('/api/settings', async (request, reply) => {
    const body = request.body as { settings: unknown };
    db.saveSettings(body.settings);
    return sendJson(reply, { ok: true });
  });

  // 25. POST /api/active-buffs
  app.post('/api/active-buffs', async (request, reply) => {
    const body = request.body as { buffs: unknown[] };
    db.saveActiveBuffs(body.buffs);
    return sendJson(reply, { ok: true });
  });

  // 26. POST /api/efficiency/:date
  app.post<{ Params: { date: string } }>('/api/efficiency/:date', async (request, reply) => {
    const body = request.body as { efficiency: unknown };
    db.saveEfficiency(request.params.date, body.efficiency);
    return sendJson(reply, { ok: true });
  });

  // 27. POST /api/freetime/:date
  app.post<{ Params: { date: string } }>('/api/freetime/:date', async (request, reply) => {
    const body = request.body as { tasks: unknown[] };
    db.saveFreeTime(request.params.date, body.tasks);
    return sendJson(reply, { ok: true });
  });

  // 28. POST /api/bounty-tasks
  app.post('/api/bounty-tasks', async (request, reply) => {
    const body = request.body as { items: unknown[] };
    db.saveBountyTasks(body.items);
    return sendJson(reply, { ok: true });
  });

  // 29. POST /api/bounty-submissions/:date
  app.post<{ Params: { date: string } }>('/api/bounty-submissions/:date', async (request, reply) => {
    const body = request.body as { submissions: unknown[] };
    db.saveBountySubmissions(request.params.date, body.submissions);
    return sendJson(reply, { ok: true });
  });

  // 30. POST /api/bounty-completions/:date
  app.post<{ Params: { date: string } }>('/api/bounty-completions/:date', async (request, reply) => {
    const body = request.body as { completions: unknown };
    db.saveBountyCompletions(request.params.date, body.completions);
    return sendJson(reply, { ok: true });
  });

  // 31. POST /api/defer-homework - 延迟作业（请求/批准/拒绝）
  app.post('/api/defer-homework', async (request, reply) => {
    const body = request.body as {
      date: string;
      hwId: string;
      action: 'request' | 'approve' | 'reject';
      requestedAt?: string;
    };
    const { date, hwId, action, requestedAt } = body;

    if (action === 'request') {
      const homeworks = db.getHomeworks(date);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found && found.status === 'pending' && !found.deferRequest) {
        found.deferRequest = {
          requestedAt: requestedAt || new Date().toISOString(),
          status: 'pending',
        };
        db.saveHomeworks(date, homeworks);
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'approve') {
      const homeworks = db.getHomeworks(date);
      const idx = homeworks.findIndex((h: any) => h.id === hwId);
      if (idx !== -1) {
        const hw = { ...homeworks[idx] };
        delete hw.deferRequest;
        hw.status = 'pending';

        // 从当前日期移除
        homeworks.splice(idx, 1);
        db.saveHomeworks(date, homeworks);

        // 添加到次日
        const tomorrow = getTomorrow(date);
        const tomorrowHw = db.getHomeworks(tomorrow);
        tomorrowHw.push(hw);
        db.saveHomeworks(tomorrow, tomorrowHw);

        return sendJson(reply, { ok: true, homework: hw });
      }
      return sendJson(reply, { ok: true });
    }

    if (action === 'reject') {
      const homeworks = db.getHomeworks(date);
      const found = homeworks.find((h: any) => h.id === hwId);
      if (found) {
        delete found.deferRequest;
        db.saveHomeworks(date, homeworks);
      }
      return sendJson(reply, { ok: true });
    }

    return sendJson(reply, { ok: true });
  });

  // 32. POST /api/reset-date - 重置日期数据
  app.post('/api/reset-date', async (request, reply) => {
    const body = request.body as { date: string };
    db.resetDate(body.date);
    return sendJson(reply, { ok: true });
  });

  // 33. POST /api/sync/push - 同步推送
  app.post('/api/sync/push', async (request, reply) => {
    const body = request.body as { changes: unknown[] };
    const result = db.pushMerge(body.changes);
    return sendJson(reply, result);
  });

  // 34. POST /api/pregen-speech - 预生成语音（后台执行）
  app.post('/api/pregen-speech', async (request, reply) => {
    const body = request.body as { texts: string[] };
    if (body.texts && body.texts.length > 0) {
      tts.pregenSpeech(body.texts);
    }
    return sendJson(reply, { ok: true });
  });

  // ==================== Static Files ====================

  if (options.webDir) {
    await app.register(fastifyStatic, {
      root: options.webDir,
      prefix: '/',
    });
  }

  // ==================== Swagger Docs ====================

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'PapaCheck API',
        description: 'PapaCheck（爸~检查！）Node.js 服务器 API',
        version: '1.0.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  return app;
}
