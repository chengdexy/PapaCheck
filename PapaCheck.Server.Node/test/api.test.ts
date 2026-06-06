// Feature: API 端点完整测试
//   Scenario: 所有 34 个 API 端点均返回正确的状态码和数据结构

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let db: any;

beforeAll(async () => {
  app = await buildApp({ port: 0, webDir: '', dbPath: ':memory:', showPollingLog: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  db = (app as any).papaCheckDB;
});

afterAll(async () => {
  await app.close();
});

// ==================== GET 端点 ====================

describe('GET /api/ping', () => {
  it('返回 ok: true 和 serverTime', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('serverTime');
    expect(typeof body.serverTime).toBe('string');
  });
});

describe('GET /api/version', () => {
  it('webDir 为空时返回 fallback 版本号', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('clientVersion');
    expect(typeof body.clientVersion).toBe('string');
  });
});

describe('GET /api/data', () => {
  it('返回完整数据结构', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('points');
    expect(body).toHaveProperty('homeworks');
    expect(body).toHaveProperty('dailySettlement');
    expect(body).toHaveProperty('shopItems');
    expect(body).toHaveProperty('redemptions');
    expect(body).toHaveProperty('rewardBox');
    expect(body).toHaveProperty('settings');
    expect(body).toHaveProperty('activeBuffs');
    expect(body).toHaveProperty('efficiencyHistory');
    expect(body).toHaveProperty('freeTimeTasks');
    expect(body).toHaveProperty('bountyTasks');
    expect(body).toHaveProperty('bountySubmissions');
    expect(body).toHaveProperty('bountyCompletions');
  });
});

describe('GET /api/homeworks/:date', () => {
  it('返回作业数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/homeworks/2026-06-06' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/settlement/:date', () => {
  it('返回日结对象或 null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settlement/2026-06-06' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // null 或 object 都可接受
    expect(body === null || typeof body === 'object').toBe(true);
  });
});

describe('GET /api/shop', () => {
  it('返回商品数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shop' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/redemptions', () => {
  it('返回兑换记录数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/redemptions' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/reward-box', () => {
  it('返回奖励箱数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reward-box' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/settings', () => {
  it('返回设置对象', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body).toBe('object');
  });
});

describe('GET /api/active-buffs', () => {
  it('返回活跃增益数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/active-buffs' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/efficiency/:date', () => {
  it('返回效率数据或 null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/efficiency/2026-06-06' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body === null || typeof body === 'object').toBe(true);
  });
});

describe('GET /api/freetime/:date', () => {
  it('返回空闲时间数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/freetime/2026-06-06' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/bounty-tasks', () => {
  it('返回赏金任务数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bounty-tasks' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/bounty-submissions/:date', () => {
  it('返回赏金提交数组', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bounty-submissions/2026-06-06' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /api/bounty-completions/:date', () => {
  it('返回赏金完成对象', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bounty-completions/2026-06-06' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body).toBe('object');
  });
});

describe('GET /api/sync/pull', () => {
  it('不传 lastSync 时返回修改记录', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/pull' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('changes');
    expect(body).toHaveProperty('serverTime');
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it('传 lastSync 时正确过滤', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?lastSync=2099-01-01T00:00:00+00:00',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.changes)).toBe(true);
  });
});

// ==================== POST 端点 ====================

describe('POST /api/data', () => {
  it('导入完整数据', async () => {
    const testData = {
      points: { balance: 100, history: [] },
      badges: [],
      homeworks: {},
      dailySettlement: {},
      shopItems: [{ id: 1, name: '测试商品', baseQuantity: 5, remainingQuantity: 5 }],
      redemptions: [],
      rewardBox: [],
      settings: { dailyBasePoints: 100 },
      activeBuffs: [],
      efficiencyHistory: {},
      freeTimeTasks: {},
      bountyTasks: [],
      bountySubmissions: {},
      bountyCompletions: {},
      history: {},
      tasks: {},
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/data',
      payload: testData,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/homeworks', () => {
  it('保存作业', async () => {
    const dateKey = '2026-06-06';
    const homeworks = [{ id: 'hw_test', subject: '数学', content: '测试作业' }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/homeworks',
      payload: { dateKey, homeworks },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);

    // 验证已保存
    const getRes = await app.inject({ method: 'GET', url: '/api/homeworks/2026-06-06' });
    const items = JSON.parse(getRes.body);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('hw_test');
  });
});

describe('POST /api/settlement/:date', () => {
  it('保存日结', async () => {
    const settlement = { rating: 'A', dailyBase: 100, actualPoints: 95 };
    const res = await app.inject({
      method: 'POST',
      url: '/api/settlement/2026-06-06',
      payload: { settlement },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/points', () => {
  it('增加积分', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/points',
      payload: { action: 'earn', amount: 50, detail: '测试加分' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('balance');
  });

  it('消耗积分', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/points',
      payload: { action: 'spend', amount: 20, detail: '测试扣分' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('balance');
  });
});

describe('POST /api/shop', () => {
  it('保存商品', async () => {
    const items = [{ id: 1, name: '零食', baseQuantity: 10, remainingQuantity: 10 }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/shop',
      payload: { items },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/redemptions', () => {
  it('保存兑换记录', async () => {
    const redemptions = [{ itemId: 'r1', itemName: '兑换测试', status: 'pending' }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/redemptions',
      payload: { redemptions },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/reward-box', () => {
  it('保存奖励箱', async () => {
    const items = [{ name: '宝箱测试', quantity: 1 }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/reward-box',
      payload: { items },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/settings', () => {
  it('保存设置', async () => {
    const settings = { dailyBasePoints: 200, ratingMultipliers: { A: 1.0, B: 0.8 } };
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { settings },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/active-buffs', () => {
  it('保存活跃增益', async () => {
    const buffs = [{ name: '专注测试', duration: 30, unit: 'min' }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/active-buffs',
      payload: { buffs },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/efficiency/:date', () => {
  it('保存效率数据', async () => {
    const efficiency = { efficiencyRatio: 0.9, averageRatio: 0.8 };
    const res = await app.inject({
      method: 'POST',
      url: '/api/efficiency/2026-06-06',
      payload: { efficiency },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/freetime/:date', () => {
  it('保存空闲时间', async () => {
    const tasks = [{ name: '自由活动测试', durationMinutes: 30 }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/freetime/2026-06-06',
      payload: { tasks },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/bounty-tasks', () => {
  it('保存赏金任务', async () => {
    const items = [{ id: 'bt_test', name: '赏金测试', points: 100 }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/bounty-tasks',
      payload: { items },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/bounty-submissions/:date', () => {
  it('保存赏金提交', async () => {
    const submissions = [{ id: 'bs_test', taskId: 'bt_test', startedAt: '2026-06-06T10:00:00Z' }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/bounty-submissions/2026-06-06',
      payload: { submissions },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/bounty-completions/:date', () => {
  it('保存赏金完成记录', async () => {
    const completions = { taskId: 'bt_test', completed: true };
    const res = await app.inject({
      method: 'POST',
      url: '/api/bounty-completions/2026-06-06',
      payload: { completions },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/defer-homework', () => {
  const testDate = '2026-06-06';
  const hwId = 'hw_defer_test';

  beforeEach(async () => {
    // 确保存在一条作业
    await app.inject({
      method: 'POST',
      url: '/api/homeworks',
      payload: {
        dateKey: testDate,
        homeworks: [{ id: hwId, subject: '延迟测试', content: '测试延迟功能', status: 'pending' }],
      },
    });
  });

  it('请求延迟作业', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/defer-homework',
      payload: { date: testDate, hwId, action: 'request', requestedAt: '2026-06-06T12:00:00Z' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);

    // 验证 deferRequest 已添加
    const getRes = await app.inject({ method: 'GET', url: `/api/homeworks/${testDate}` });
    const items = JSON.parse(getRes.body);
    const hw = items.find((h: any) => h.id === hwId);
    expect(hw.deferRequest).toBeDefined();
    expect(hw.deferRequest.status).toBe('pending');
  });

  it('批准延迟作业（移动作业到第二天）', async () => {
    // 先请求
    await app.inject({
      method: 'POST',
      url: '/api/defer-homework',
      payload: { date: testDate, hwId, action: 'request', requestedAt: '2026-06-06T12:00:00Z' },
    });

    // 批准
    const res = await app.inject({
      method: 'POST',
      url: '/api/defer-homework',
      payload: { date: testDate, hwId, action: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('homework');

    // 验证原日期的作业已移除
    const getFromRes = await app.inject({ method: 'GET', url: `/api/homeworks/${testDate}` });
    const fromItems = JSON.parse(getFromRes.body);
    expect(fromItems.find((h: any) => h.id === hwId)).toBeUndefined();

    // 验证作业已移到第二天
    const tomorrow = '2026-06-07';
    const getToRes = await app.inject({ method: 'GET', url: `/api/homeworks/${tomorrow}` });
    const toItems = JSON.parse(getToRes.body);
    const movedHw = toItems.find((h: any) => h.id === hwId);
    expect(movedHw).toBeDefined();
    expect(movedHw.deferRequest).toBeUndefined();
    expect(movedHw.status).toBe('pending');
  });

  it('拒绝延迟作业', async () => {
    // 先请求
    await app.inject({
      method: 'POST',
      url: '/api/defer-homework',
      payload: { date: testDate, hwId, action: 'request', requestedAt: '2026-06-06T12:00:00Z' },
    });

    // 拒绝
    const res = await app.inject({
      method: 'POST',
      url: '/api/defer-homework',
      payload: { date: testDate, hwId, action: 'reject' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);

    // 验证 deferRequest 已清除
    const getRes = await app.inject({ method: 'GET', url: `/api/homeworks/${testDate}` });
    const items = JSON.parse(getRes.body);
    const hw = items.find((h: any) => h.id === hwId);
    expect(hw.deferRequest).toBeUndefined();
  });
});

describe('POST /api/reset-date', () => {
  it('重置指定日期的数据', async () => {
    // 先写入一些数据
    await app.inject({
      method: 'POST',
      url: '/api/homeworks/2026-06-10',
      payload: { homeworks: [{ id: 'hw_reset', subject: '重置测试' }] },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reset-date',
      payload: { date: '2026-06-10' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);

    // 验证已清空
    const getRes = await app.inject({ method: 'GET', url: '/api/homeworks/2026-06-10' });
    expect(JSON.parse(getRes.body)).toEqual([]);
  });
});

describe('POST /api/sync/push', () => {
  it('推送变更合并', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {
        changes: [
          {
            type: 'update',
            uuid: 'points-1',
            data: { balance: 500, lastModified: '2026-06-06T10:00:00Z' },
            timestamp: '2026-06-06T10:00:00Z',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('POST /api/pregen-speech', () => {
  it('后台预生成语音（不阻塞响应）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pregen-speech',
      payload: { texts: ['你好', '世界'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

// ==================== CORS 头验证 ====================

describe('CORS 头', () => {
  it('所有响应都包含 Access-Control-Allow-Origin: *', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ping' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('OPTIONS 请求处理 CORS 预检', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/api/ping' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// ==================== TTS 端点 ====================

describe('GET /api/speak', () => {
  it('缺少 text 参数时返回 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/speak' });
    expect(res.statusCode).toBe(400);
  });

  it('有 text 参数时返回 MP3 音频', async () => {
    // Mock TTS to return empty buffer
    const tts = (app as any).tts;
    const originalSpeak = tts.speak.bind(tts);
    tts.speak = vi.fn().mockResolvedValue(Buffer.from('fake-mp3'));

    const res = await app.inject({ method: 'GET', url: '/api/speak?text=你好' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');

    // Restore
    tts.speak = originalSpeak;
  });
});

// ==================== PUT Endpoints ====================

describe('PUT /api/homeworks/:id', () => {
  it('创建新的作业', async () => {
    const hw = { id: 'hw-put-1', subject: '数学', content: '测试', status: 'pending' };
    const res = await app.inject({ method: 'PUT', url: '/api/homeworks/hw-put-1', payload: hw });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('ok', true);
  });
});

describe('PUT /api/settlement/:date', () => {
  it('全量更新结算', async () => {
    const data = { rating: 'A', dailyBase: 100, actualPoints: 95 };
    const res = await app.inject({ method: 'PUT', url: '/api/settlement/2026-06-06', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/shop/:id', () => {
  it('全量更新商店商品', async () => {
    const item = { id: 'shop-put-1', name: '测试商品', baseQuantity: 5, remainingQuantity: 5 };
    const res = await app.inject({ method: 'PUT', url: '/api/shop/shop-put-1', payload: item });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/redemptions/:id', () => {
  it('全量更新兑换记录', async () => {
    const data = { id: 'red-put-1', itemId: 'r1', itemName: '兑换测试', status: 'pending' };
    const res = await app.inject({ method: 'PUT', url: '/api/redemptions/red-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/reward-box/:id', () => {
  it('全量更新奖励箱', async () => {
    const data = { id: 'rb-put-1', name: '宝箱测试', quantity: 1 };
    const res = await app.inject({ method: 'PUT', url: '/api/reward-box/rb-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/settings', () => {
  it('全量更新设置', async () => {
    const data = { dailyBasePoints: 150, ratingMultipliers: { A: 1.0, B: 0.8 } };
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/active-buffs/:id', () => {
  it('全量更新 Buff', async () => {
    const data = { id: 'buff-put-1', name: '专注测试', duration: 30, unit: 'min' };
    const res = await app.inject({ method: 'PUT', url: '/api/active-buffs/buff-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/efficiency/:date', () => {
  it('全量更新效率', async () => {
    const data = { efficiencyRatio: 0.9, averageRatio: 0.8 };
    const res = await app.inject({ method: 'PUT', url: '/api/efficiency/2026-06-06', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/freetime/:id', () => {
  it('全量更新自由时间', async () => {
    const data = { id: 'ft-put-1', name: '自由活动测试', durationMinutes: 30 };
    const res = await app.inject({ method: 'PUT', url: '/api/freetime/ft-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/bounty-tasks/:id', () => {
  it('全量更新赏金任务', async () => {
    const data = { id: 'bt-put-1', name: '赏金测试', points: 100 };
    const res = await app.inject({ method: 'PUT', url: '/api/bounty-tasks/bt-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/bounty-submissions/:id', () => {
  it('全量更新赏金提交', async () => {
    const data = { id: 'bs-put-1', taskId: 'bt_test', startedAt: '2026-06-06T10:00:00Z' };
    const res = await app.inject({ method: 'PUT', url: '/api/bounty-submissions/bs-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PUT /api/bounty-completions/:id', () => {
  it('全量更新赏金完成', async () => {
    const data = { id: 'bc-put-1', taskId: 'bt_test', completed: true };
    const res = await app.inject({ method: 'PUT', url: '/api/bounty-completions/bc-put-1', payload: data });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

// ==================== PATCH Endpoints ====================

describe('PATCH /api/homeworks/:id', () => {
  it('部分更新作业状态', async () => {
    // 先创建一条作业
    const hw = { id: 'hw-patch-1', subject: '英语', content: '测试', status: 'pending' };
    await app.inject({ method: 'PUT', url: '/api/homeworks/hw-patch-1', payload: hw });

    const res = await app.inject({ method: 'PATCH', url: '/api/homeworks/hw-patch-1', payload: { status: 'in_progress' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);

    // 验证更新
    const getRes = await app.inject({ method: 'GET', url: '/api/homeworks/2026-06-06' });
    const items = JSON.parse(getRes.body);
    const updated = items.find((h: any) => h.id === 'hw-patch-1');
    expect(updated).toBeDefined();
    expect(updated.status).toBe('in_progress');
  });
});

describe('PATCH /api/settlement/:date', () => {
  it('部分更新结算', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/settlement/2026-06-06', payload: { rating: 'A+' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('PATCH /api/points', () => {
  it('增量更新积分', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/points', payload: { earn: 10, detail: '测试加分' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('balance');
  });
});

describe('PATCH /api/settings', () => {
  it('部分更新设置', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { dailyBasePoints: 200 } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

// ==================== DELETE Endpoints ====================

describe('DELETE /api/homeworks/:id', () => {
  it('软删作业', async () => {
    // 先创建一条作业
    const hw = { id: 'hw-del-1', subject: '语文', content: '删除测试', status: 'pending' };
    await app.inject({ method: 'PUT', url: '/api/homeworks/hw-del-1', payload: hw });

    const res = await app.inject({ method: 'DELETE', url: '/api/homeworks/hw-del-1', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('DELETE /api/shop/:id', () => {
  it('软删商品', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/shop/shop-put-1', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('DELETE /api/active-buffs/:id', () => {
  it('软删 Buff', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/active-buffs/buff-put-1', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

describe('DELETE /api/bounty-tasks/:id', () => {
  it('软删赏金任务', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/bounty-tasks/bt-put-1', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});

// ==================== HEAD Endpoints ====================

describe('HEAD /api/homeworks/:id', () => {
  it('返回 200（由 GET 路由自动生成 HEAD）', async () => {
    // 先创建一条作业
    const hw = { id: 'hw-head-1', subject: '科学', content: 'HEAD测试', status: 'pending' };
    await app.inject({ method: 'PUT', url: '/api/homeworks/hw-head-1', payload: hw });

    const res = await app.inject({ method: 'HEAD', url: '/api/homeworks/hw-head-1' });
    expect(res.statusCode).toBe(200);
  });

  it('不存在的记录也返回 200（GET 返回空数组）', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/api/homeworks/nonexistent-id' });
    expect(res.statusCode).toBe(200);
  });
});

describe('HEAD /api/shop/:id', () => {
  it('存在的商品返回 200', async () => {
    // 先创建一条商品供 HEAD 检查
    const item = { id: 'shop-head-1', name: 'HEAD商品', baseQuantity: 3, remainingQuantity: 3 };
    await app.inject({ method: 'PUT', url: '/api/shop/shop-head-1', payload: item });

    const res = await app.inject({ method: 'HEAD', url: '/api/shop/shop-head-1' });
    expect(res.statusCode).toBe(200);
  });
});

describe('HEAD /api/bounty-tasks/:id', () => {
  it('存在的赏金任务返回 200', async () => {
    const data = { id: 'bt-head-1', name: 'HEAD赏金', points: 50 };
    await app.inject({ method: 'PUT', url: '/api/bounty-tasks/bt-head-1', payload: data });

    const res = await app.inject({ method: 'HEAD', url: '/api/bounty-tasks/bt-head-1' });
    expect(res.statusCode).toBe(200);
  });
});

// ==================== CRDT 同步端点 ====================

describe('POST /api/sync/crdt-push', () => {
  it('接受空操作列表', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync/crdt-push', payload: { operations: [] } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });

  it('推送一条操作日志并正确合并', async () => {
    const op = {
      id: 'test-op-1', type: 'update', table: 'homeworks',
      resourceId: 'hw-crdt-1', field: 'status', value: 'completed',
      timestamp: '2026-06-06T00:00:00Z', nodeId: 'test-node',
    };
    const res = await app.inject({ method: 'POST', url: '/api/sync/crdt-push', payload: { operations: [op] } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);

    // 验证操作已持久化（通过 crdt-pull 验证）
    const pullRes = await app.inject({ method: 'GET', url: '/api/sync/crdt-pull?since=1970-01-01T00:00:00Z' });
    expect(pullRes.statusCode).toBe(200);
    const body = JSON.parse(pullRes.body);
    expect(body.operations.length).toBeGreaterThanOrEqual(1);
    expect(body.operations.some((o: any) => o.id === 'test-op-1')).toBe(true);
  });
});

describe('GET /api/sync/crdt-pull', () => {
  it('since 参数过滤正确', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/crdt-pull?since=2026-06-07T00:00:00Z' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('operations');
    expect(Array.isArray(body.operations)).toBe(true);
  });
});

describe('POST /api/sync/crdt-pull?ack=', () => {
  it('确认已消费的操作', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/sync/crdt-pull?ack=2026-06-06T00:00:00Z' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty('ok', true);
  });
});
