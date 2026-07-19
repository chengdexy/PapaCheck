/**
 * data-layer.test.js — T9 验收闸门（前端数据按需获取重构）
 *
 * 验收目标（对应架构 §6 T9 / PRD AC-2）：
 *  1. StatsAgg 契约：/api/stats 真实响应形状经 Data.loadAdminStats -> _normalizeStats 归一化后字段齐全、date 由 label 正确映射。
 *  2. AC-2 等价性：对 week/month/all 三范围，服务端聚合(raw, UTC) 经 _normalizeStats 的 StatsAgg
 *     须与 legacy 算法 Data.computeStatsFromCachedData(range)（旧客户端基线）逐项一致。
 *  3. 降级 fallback：loadAdminStats 的按需端点失败 -> fallbackToFullCachedData()（API.getData 全量）-> computeStatsFromCachedData 仍产出 statsAgg 不抛错；
 *     loadConfig 单端点失败不影响其他字段。
 *  4. 静态校验：消费者(app/big-screen/admin)不再调用 API.getData()；migrateBountyCompletionsToTotal 调用已清除（定义可保留）；data-layer.js 保留唯一降级通道。
 *
 * 已知隐患（确定性验证）：服务端 getWeekStart/formatWeekLabel 用 UTC；data-layer 用本地时区 + toISOString()（UTC 序列化）。
 *  仅当 range='all' 且历史天数 32–180（触发 week 粒度）时，两端周分桶可能因时区差不一致。
 *  本环境 Node 把 date-only 字符串当作 UTC 解析（掩盖分歧），故对风险用例注入“浏览器准确”的 +8 本地 Date 以确定性复现。
 *
 * 运行：vitest run（同目录自动纳入）。本文件零新依赖，沿用 vm.runInContext 加载 data-layer.js 并注入受控 globals。
 */

import { describe, test, assert } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const DATA_LAYER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'data-layer.js'),
  'utf8'
);

// ============ 测试工具：在受控 vm context 中加载 data-layer.js ============

/**
 * 创建隔离 context 并加载 data-layer.js，返回 context（context.Data 即实例）。
 * @param {object} overrides 覆盖注入的全局（如 API / cachedData / Date）
 * @param {Function} [DateImpl] 注入的 Date 实现（默认宿主 Date；风险用例注入 +8 本地 Date）
 */
function loadDataLayer(overrides = {}, DateImpl) {
  const API = {
    API_BASE: '/api',
    _fetch: async () => { throw new Error('API._fetch 未注入 mock'); },
    getData: async () => { throw new Error('API.getData 未注入 mock'); },
    getShopItems: async () => null,
    getRedemptions: async () => null,
    getRewardBox: async () => null,
    getBountyTasks: async () => null,
    getActiveBuffs: async () => null,
    getSettings: async () => null,
    getPointsBalance: async () => null,
    getHomeworks: async () => null,
    getSettlement: async () => null,
    getFreeTime: async () => null,
    getBountySubmissions: async () => null,
    ...(overrides.API || {}),
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => ({}),
    Promise,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Error,
    Date: DateImpl || Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    RegExp,
    Symbol,
    Map,
    Set,
    atob: typeof atob !== 'undefined' ? atob : undefined,

    cachedData: overrides.cachedData !== undefined ? overrides.cachedData : null,
    isServerMode: false,
    API,
    Util: undefined,
    AdminUtil: undefined,
    currentDate: undefined,
    adminDate: undefined,
    adminCurrentTab: undefined,
    _statsRange: undefined,
    window: {},
    ...overrides,
  };
  // 去掉已展开的键，避免二次覆盖
  delete context.cachedData;
  delete context.API;
  context.cachedData = overrides.cachedData !== undefined ? overrides.cachedData : null;
  context.API = API;

  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(DATA_LAYER_SRC, context, { filename: 'data-layer.js' });
  return context;
}

// ============ 服务端聚合逻辑（UTC 版，逐字复制自 handler-body.js L41011-41159）============
// 用于构建“服务端 raw 响应”，与 handler-body.js buildStatsFromData 逐字节一致。

function getGroupMode(dateCount, range) {
  if (range !== 'all') return 'day';
  if (dateCount <= 31) return 'day';
  if (dateCount <= 180) return 'week';
  return 'month';
}
function parseYmd(dateStr) {
  const parts = dateStr.split('-').map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}
function serverGetWeekStart(dateStr) {
  const { y, m, d } = parseYmd(dateStr);
  const base = new Date(Date.UTC(y, m - 1, d));
  const day = base.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(base.getTime() - diffToMonday * 864e5);
  const yy = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function serverFormatWeekLabel(key) {
  const { y, m, d } = parseYmd(key);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * 864e5);
  const fmt = (dt) => `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
  return `${fmt(start)}-${fmt(end)}`;
}
function sAggregateDaily(data, groupMode, mode) {
  if (!data.length) return [];
  if (groupMode === 'day') return data.map((d) => ({ label: d.date.slice(5), value: d.value }));
  const groups = {};
  data.forEach((d) => {
    const key = groupMode === 'week' ? serverGetWeekStart(d.date) : d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return Object.entries(groups).map(([key, items]) => {
    const sum = items.reduce((s, d) => s + d.value, 0);
    const value = mode === 'mean' ? Math.round(sum / items.length) : Math.round(sum);
    return { label: groupMode === 'week' ? serverFormatWeekLabel(key) : key, value };
  });
}
function sAggregateCompletionData(data, groupMode) {
  if (!data.length) return [];
  if (groupMode === 'day') return data.map((d) => ({ label: d.date.slice(5), inSchool: d.inSchool, atHome: d.atHome }));
  const groups = {};
  data.forEach((d) => {
    const key = groupMode === 'week' ? serverGetWeekStart(d.date) : d.date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  return Object.entries(groups).map(([key, items]) => {
    const inSchool = items.reduce((s, d) => s + d.inSchool, 0);
    const atHome = items.reduce((s, d) => s + d.atHome, 0);
    return { label: groupMode === 'week' ? serverFormatWeekLabel(key) : key, inSchool, atHome };
  });
}
function sCalcStreak(allDates, settlementByDate) {
  if (allDates.length === 0) return 0;
  const sorted = [].concat(allDates).sort().reverse();
  let streak = 0;
  let started = false;
  for (const dk of sorted) {
    const s = settlementByDate[dk];
    if (s && s.rating && s.rating !== '差') {
      streak++;
      started = true;
    } else if (started) {
      break;
    }
  }
  return streak;
}
function serverBuildStatsFromData(input) {
  const { settlementByDate, homeworksByDate, dateRange, allDates, range } = input;
  const groupMode = getGroupMode(dateRange.length, range);
  const totalMinData = [];
  const effRatioData = [];
  const dailyPointsData = [];
  const completedInSchoolBarData = [];
  dateRange.forEach((date) => {
    const hwList = homeworksByDate[date] || [];
    const doneHw = hwList.filter((h) => h.status === 'done' && !h.rejected);
    const totalMin = doneHw.reduce((sum, h) => sum + (h.actualDuration || 0), 0);
    totalMinData.push({ date, value: totalMin });
    const effHw = doneHw.filter((h) => h.suggestedDuration > 0 && h.actualDuration !== null);
    const ratios = effHw.map((h) => h.suggestedDuration / h.actualDuration);
    const avgRatio = ratios.length > 0 ? Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length * 100) : 0;
    effRatioData.push({ date, value: avgRatio });
    const settlement = settlementByDate[date];
    dailyPointsData.push({ date, value: settlement ? (settlement.finalPoints != null ? settlement.finalPoints : 0) : 0 });
    const inSchool = doneHw.filter((h) => h.completedInSchool).length;
    const atHome = doneHw.length - inSchool;
    completedInSchoolBarData.push({ date, inSchool, atHome });
  });
  const totalMinutes = sAggregateDaily(totalMinData, groupMode, 'mean');
  const efficiencyRatios = sAggregateDaily(effRatioData, groupMode, 'mean');
  const dailyPoints = sAggregateDaily(dailyPointsData, groupMode);
  const ratingsListDates = dateRange.filter((d) => settlementByDate[d] && settlementByDate[d].rating).reverse();
  const ratingCounts = {};
  ratingsListDates.forEach((d) => {
    const r = settlementByDate[d].rating;
    if (r) ratingCounts[r] = (ratingCounts[r] || 0) + 1;
  });
  const ratingTotal = Object.keys(ratingCounts).reduce((s, k) => s + ratingCounts[k], 0);
  const completedInSchool = sAggregateCompletionData(completedInSchoolBarData, groupMode);
  const ratingsList = ratingsListDates.map((d) => {
    const s = settlementByDate[d];
    return {
      date: d,
      rating: s.rating,
      totalBeforeRating: s.totalBeforeRating,
      multiplier: s.multiplier,
      finalPoints: s.finalPoints,
    };
  });
  const streak = sCalcStreak(allDates, settlementByDate);
  const avgTotalMin = totalMinutes.length > 0 ? Math.round(totalMinutes.reduce((a, b) => a + b.value, 0) / totalMinutes.length) : 0;
  const avgEff = efficiencyRatios.filter((e) => e.value > 0);
  const avgEffVal = avgEff.length > 0 ? Math.round(avgEff.reduce((a, b) => a + b.value, 0) / avgEff.length) : 0;
  const totalPoints = dailyPoints.reduce((a, b) => a + b.value, 0);
  return {
    range,
    groupMode,
    totalMinutes,
    efficiencyRatios,
    dailyPoints,
    ratingCounts,
    ratingTotal,
    ratingsList,
    completedInSchool,
    streak,
    avgTotalMin,
    avgEffVal,
    totalPoints,
  };
}

/** 按 range 复刻服务端 buildStatsFromData 的 dateRange 切片逻辑 */
function serverRawForRange(range, fixture) {
  const settlementByDate = fixture.dailySettlement;
  const homeworksByDate = fixture.homeworks;
  const allDates = Object.keys(settlementByDate).sort();
  const maxDays = range === 'month' ? 30 : range === 'week' ? 7 : 9999;
  const dateRange = maxDays >= 9999 ? allDates : allDates.slice(-maxDays);
  return serverBuildStatsFromData({ settlementByDate, homeworksByDate, dateRange, allDates, range });
}

// ============ 浏览器准确的 +8 本地 Date（用于确定性复现时区分歧）============
// Node 把 date-only 当 UTC 解析（掩盖分歧）；浏览器当本地解析。此实现模拟本地解析 + 真实 toISOString(UTC)。

const TZ_OFFSET_MS = 8 * 3600 * 1000;
class LocalPlus8Date {
  constructor(...args) {
    if (args.length === 0) {
      this._t = Date.now();
    } else if (args.length === 1) {
      const a = args[0];
      if (typeof a === 'string') {
        const m = a.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          const y = +m[1], mo = +m[2] - 1, d = +m[3];
          this._t = Date.UTC(y, mo, d) - TZ_OFFSET_MS; // 本地午夜(+8) = UTC 前移 8h
        } else {
          this._t = new Date(a).getTime();
        }
      } else if (typeof a === 'number') {
        this._t = a;
      } else {
        this._t = a.getTime();
      }
    } else {
      const [y, mo, d, h = 0, min = 0, s = 0, ms = 0] = args;
      this._t = Date.UTC(y, mo, d, h, min, s, ms) - TZ_OFFSET_MS;
    }
  }
  getFullYear() { return new Date(this._t + TZ_OFFSET_MS).getUTCFullYear(); }
  getMonth() { return new Date(this._t + TZ_OFFSET_MS).getUTCMonth(); }
  getDate() { return new Date(this._t + TZ_OFFSET_MS).getUTCDate(); }
  getDay() { return new Date(this._t + TZ_OFFSET_MS).getUTCDay(); }
  getHours() { return new Date(this._t + TZ_OFFSET_MS).getUTCHours(); }
  getMinutes() { return new Date(this._t + TZ_OFFSET_MS).getUTCMinutes(); }
  getSeconds() { return new Date(this._t + TZ_OFFSET_MS).getUTCSeconds(); }
  getTime() { return this._t; }
  setDate(n) {
    const l = new Date(this._t + TZ_OFFSET_MS);
    l.setUTCDate(n);
    this._t = l.getTime() - TZ_OFFSET_MS;
    return this._t;
  }
  toISOString() { return new Date(this._t).toISOString(); }
  static now() { return Date.now(); }
}

// ============ Fixture 生成（确定性、可复现）============

const RATINGS = ['优', '良', '可', '差'];

/**
 * 生成全量 cachedData fixture。
 * @param {number} numDays 历史天数
 * @param {string} endDateStr 截止日期(ISO)，如 '2026-07-10'
 */
function buildFixture(numDays, endDateStr) {
  const homeworks = {};
  const dailySettlement = {};
  const bountyCompletions = { _total: { t1: numDays, t2: Math.floor(numDays / 2) } };
  const end = new Date(endDateStr + 'T00:00:00Z').getTime();
  for (let i = numDays - 1; i >= 0; i--) {
    const dateStr = new Date(end - i * 864e5).toISOString().slice(0, 10);
    homeworks[dateStr] = [
      { id: 'h1', status: 'done', rejected: false, actualDuration: 60, suggestedDuration: 50, completedInSchool: true },
      { id: 'h2', status: 'done', rejected: false, actualDuration: 30, suggestedDuration: 45, completedInSchool: false },
      { id: 'h3', status: 'pending', actualDuration: 0, suggestedDuration: 20, completedInSchool: false },
    ];
    const rating = RATINGS[i % 4];
    dailySettlement[dateStr] = {
      rating,
      totalBeforeRating: 100 + i,
      multiplier: rating === '优' ? 2 : 1,
      finalPoints: (i % 7) * 10,
    };
  }
  return {
    homeworks,
    dailySettlement,
    bountyCompletions,
    freeTimeTasks: {},
    bountySubmissions: {},
    shopItems: [],
    redemptions: [],
    rewardBox: [],
    bountyTasks: [],
    activeBuffs: [],
    settings: {},
    points: { balance: 0 },
    tenant_id: 'tenant-x',
    child_id: 'child-y',
  };
}

// ============ 测试 ============

describe('StatsAgg 契约（data-layer._normalizeStats 经 loadAdminStats）', () => {
  test('服务端真实响应形状被归一化为契约 StatsAgg，date 由 label 正确映射', async () => {
    const raw = {
      range: 'week',
      groupMode: 'day',
      totalMinutes: [{ label: '07-01', value: 120 }, { label: '07-02', value: 90 }],
      efficiencyRatios: [{ label: '07-01', value: 83 }, { label: '07-02', value: 67 }],
      dailyPoints: [{ label: '07-01', value: 50 }, { label: '07-02', value: 30 }],
      completedInSchool: [
        { label: '07-01', inSchool: 2, atHome: 1 },
        { label: '07-02', inSchool: 1, atHome: 2 },
      ],
      ratingCounts: { '优': 2, '良': 1, '可': 0, '差': 0 },
      ratingTotal: 3,
      ratingsList: [
        { date: '2026-07-01', rating: '优', totalBeforeRating: 100, multiplier: 2, finalPoints: 50 },
        { date: '2026-07-02', rating: '良', totalBeforeRating: 150, multiplier: 1, finalPoints: 30 },
      ],
      streak: 5,
      avgTotalMin: 105,
      avgEffVal: 75,
      totalPoints: 80,
    };

    let fetchedUrl = null;
    const ctx = loadDataLayer({
      cachedData: null,
      API: {
        _fetch: async (url) => { fetchedUrl = url; return JSON.parse(JSON.stringify(raw)); },
      },
    });

    const stats = await ctx.Data.loadAdminStats('week');

    assert.ok(fetchedUrl && fetchedUrl.includes('/stats?range=week'), '应请求 /api/stats?range=week');
    assert.strictEqual(stats.range, 'week');
    assert.strictEqual(stats.groupMode, 'day');
    assert.deepStrictEqual(stats.totalMinutes, [{ date: '07-01', value: 120 }, { date: '07-02', value: 90 }]);
    assert.deepStrictEqual(stats.efficiencyRatios, [{ date: '07-01', value: 83 }, { date: '07-02', value: 67 }]);
    assert.deepStrictEqual(stats.dailyPoints, [{ date: '07-01', value: 50 }, { date: '07-02', value: 30 }]);
    assert.deepStrictEqual(stats.completedInSchool, [
      { date: '07-01', inSchool: 2, atHome: 1 },
      { date: '07-02', inSchool: 1, atHome: 2 },
    ]);
    assert.deepStrictEqual(stats.ratingCounts, { '优': 2, '良': 1, '可': 0, '差': 0 });
    assert.strictEqual(stats.ratingTotal, 3);
    assert.deepStrictEqual(stats.ratingsList, [
      { date: '2026-07-01', rating: '优', totalBeforeRating: 100, multiplier: 2, finalPoints: 50 },
      { date: '2026-07-02', rating: '良', totalBeforeRating: 150, multiplier: 1, finalPoints: 30 },
    ]);
    assert.strictEqual(stats.streak, 5);
    assert.strictEqual(stats.avgTotalMin, 105);
    assert.strictEqual(stats.avgEffVal, 75);
    assert.strictEqual(stats.totalPoints, 80);
  });

  test('raw 缺 groupMode 时回退 day；缺 streak 时本地兜底（不抛错）', async () => {
    const raw = {
      totalMinutes: [{ label: '07-01', value: 10 }],
      efficiencyRatios: [{ label: '07-01', value: 50 }],
      dailyPoints: [{ label: '07-01', value: 5 }],
      completedInSchool: [{ label: '07-01', inSchool: 1, atHome: 0 }],
      ratingCounts: { '优': 1, '良': 0, '可': 0, '差': 0 },
      ratingTotal: 1,
      ratingsList: [{ date: '2026-07-01', rating: '优', totalBeforeRating: 0, multiplier: 1, finalPoints: 5 }],
      // 故意缺 streak
      avgTotalMin: 10,
      avgEffVal: 50,
      totalPoints: 5,
    };
    const ctx = loadDataLayer({
      cachedData: { dailySettlement: { '2026-07-01': { rating: '优' } } },
      API: { _fetch: async () => JSON.parse(JSON.stringify(raw)) },
    });
    const stats = await ctx.Data.loadAdminStats('week');
    assert.strictEqual(stats.groupMode, 'day', '缺 groupMode 应回退 day');
    assert.strictEqual(stats.streak, 1, '缺 streak 应本地兜底按全历史算');
  });
});

describe('AC-2 等价性：服务端聚合(UTC) StatsAgg == 旧客户端基线(computeStatsFromCachedData)', () => {
  test("week 范围：服务端 == 客户端基线（day 粒度，逐项一致）", async () => {
    const fixture = buildFixture(40, '2026-07-10'); // 40 天，week 取最近 7
    const ctx = loadDataLayer({ cachedData: fixture });
    const A = ctx.Data.computeStatsFromCachedData('week');
    const raw = serverRawForRange('week', fixture);
    ctx.API._fetch = async () => raw;
    const B = await ctx.Data.loadAdminStats('week');
    assert.deepStrictEqual(B, A, 'week 范围 StatsAgg 必须逐项一致（AC-2）');
  });

  test("month 范围：服务端 == 客户端基线（day 粒度，逐项一致）", async () => {
    const fixture = buildFixture(40, '2026-07-10'); // month 取最近 30
    const ctx = loadDataLayer({ cachedData: fixture });
    const A = ctx.Data.computeStatsFromCachedData('month');
    const raw = serverRawForRange('month', fixture);
    ctx.API._fetch = async () => raw;
    const B = await ctx.Data.loadAdminStats('month');
    assert.deepStrictEqual(B, A, 'month 范围 StatsAgg 必须逐项一致（AC-2）');
  });

  test("all 范围(<=31天)：服务端 == 客户端基线（day 粒度，逐项一致）", async () => {
    const fixture = buildFixture(20, '2026-07-10'); // <=31 -> day
    const ctx = loadDataLayer({ cachedData: fixture });
    const A = ctx.Data.computeStatsFromCachedData('all');
    const raw = serverRawForRange('all', fixture);
    ctx.API._fetch = async () => raw;
    const B = await ctx.Data.loadAdminStats('all');
    assert.deepStrictEqual(B, A, 'all(<=31d) StatsAgg 必须逐项一致（AC-2）');
  });

  test("all 范围(>180天)：服务端 == 客户端基线（month 粒度，逐项一致）", async () => {
    const fixture = buildFixture(200, '2026-07-10'); // >180 -> month
    const ctx = loadDataLayer({ cachedData: fixture });
    const A = ctx.Data.computeStatsFromCachedData('all');
    const raw = serverRawForRange('all', fixture);
    ctx.API._fetch = async () => raw;
    const B = await ctx.Data.loadAdminStats('all');
    assert.deepStrictEqual(B, A, 'all(>180d) StatsAgg 必须逐项一致（AC-2）');
  });
});

describe('降级 fallback', () => {
  test('loadAdminStats 按需端点失败 -> fallbackToFullCachedData(API.getData 全量) -> computeStatsFromCachedData 产出 statsAgg 不抛错', async () => {
    const fixture = buildFixture(40, '2026-07-10');
    let fetchCalled = false;
    let getDataCalled = false;
    const ctx = loadDataLayer({
      cachedData: null,
      API: {
        _fetch: async () => { fetchCalled = true; throw new Error('network down'); },
        getData: async () => { getDataCalled = true; return JSON.parse(JSON.stringify(fixture)); },
      },
    });
    let stats = null;
    let threw = false;
    try {
      stats = await ctx.Data.loadAdminStats('week');
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, false, '降级路径不应抛出未捕获异常');
    assert.strictEqual(fetchCalled, true, '应先尝试按需端点');
    assert.strictEqual(getDataCalled, true, '失败后应回退 API.getData 全量');
    assert.ok(stats && stats.range === 'week', '应返回合法 statsAgg');
    assert.strictEqual(ctx.cachedData && ctx.cachedData.tenant_id, 'tenant-x', '降级后应已用全量填充 cachedData');
    // 与直接基线一致
    const baseline = ctx.Data.computeStatsFromCachedData('week');
    assert.deepStrictEqual(stats, baseline, '降级产出的 statsAgg 应与基线一致');
  });

  test('loadConfig 单端点失败不影响其他字段填充', async () => {
    const ctx = loadDataLayer({
      cachedData: null,
      API: {
        getShopItems: async () => { throw new Error('shop failed'); },
        getRedemptions: async () => [{ id: 'r1' }],
        getRewardBox: async () => [{ id: 'b1' }],
        getBountyTasks: async () => [{ id: 't1' }],
        getActiveBuffs: async () => [{ id: 'a1' }],
        getSettings: async () => ({ theme: 'dark' }),
        getPointsBalance: async () => ({ balance: 42 }),
      },
    });
    let threw = false;
    try {
      await ctx.Data.loadConfig();
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, false, '单端点失败不应导致 loadConfig 抛错');
    const snap = ctx.Data.getSnapshot();
    assert.deepStrictEqual(snap.redemptions, [{ id: 'r1' }], '其余端点应正常填充');
    assert.deepStrictEqual(snap.rewardBox, [{ id: 'b1' }]);
    assert.deepStrictEqual(snap.bountyTasks, [{ id: 't1' }]);
    assert.deepStrictEqual(snap.activeBuffs, [{ id: 'a1' }]);
    assert.deepStrictEqual(snap.settings, { theme: 'dark' });
    assert.deepStrictEqual(snap.points, { balance: 42 });
    assert.deepStrictEqual(snap.shopItems, [], '失败端点应保留既有（空）值，不污染');
  });
});

describe('静态校验：消费者迁移 & 降级通道约束', () => {
  const SRC_DIR = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  const appSrc = read('app.js');
  const bigSrc = read('big-screen.js');
  const adminSrc = read('admin.js');
  const apiSrc = read('api.js');
  const dataLayerSrc = read('data-layer.js');

  test('app.js / big-screen.js / admin.js 不再直接调用 API.getData()', () => {
    const re = /API\.getData\(/;
    assert.strictEqual(re.test(appSrc), false, 'app.js 不应含 API.getData()');
    assert.strictEqual(re.test(bigSrc), false, 'big-screen.js 不应含 API.getData()');
    assert.strictEqual(re.test(adminSrc), false, 'admin.js 不应含 API.getData()');
  });

  test('migrateBountyCompletionsToTotal 调用已从消费者清除（api.js 定义保留）', () => {
    const callRe = /migrateBountyCompletionsToTotal\(/;
    assert.strictEqual(callRe.test(appSrc), false, 'app.js 不应调用 migrateBountyCompletionsToTotal');
    assert.strictEqual(callRe.test(bigSrc), false, 'big-screen.js 不应调用 migrateBountyCompletionsToTotal');
    assert.strictEqual(callRe.test(adminSrc), false, 'admin.js 不应调用 migrateBountyCompletionsToTotal');
    assert.ok(/function migrateBountyCompletionsToTotal\(/.test(apiSrc), 'api.js 定义应保留');
  });

  test('data-layer.js 保留唯一降级通道 API.getData()，且导出 computeStatsFromCachedData 供回归基线', () => {
    assert.ok(/API\.getData\(/.test(dataLayerSrc), 'data-layer.js 应保留降级通道 API.getData()');
    assert.ok(/computeStatsFromCachedData/.test(dataLayerSrc), 'data-layer.js 应导出 computeStatsFromCachedData');
  });
});

describe('已知隐患：all-range(32-180天) week 分桶时区分歧（确定性验证）', () => {
  test('LocalPlus8Date 模拟下，data-layer 本地周起点 != 服务端 UTC 周起点（根因确认）', () => {
    // 直接比对两端周起点函数，证明分歧真实存在（非环境巧合）
    const serverWS = (s) => serverGetWeekStart(s);
    const localWS = (s) => {
      const d = new LocalPlus8Date(s);
      const day = d.getDay();
      const mon = new LocalPlus8Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      return mon.toISOString().slice(0, 10);
    };
    const samples = ['2026-07-01', '2026-07-06', '2026-01-01', '2026-12-31'];
    let anyDiff = false;
    for (const s of samples) {
      if (serverWS(s) !== localWS(s)) anyDiff = true;
    }
    assert.strictEqual(anyDiff, true, '非 UTC(+8) 客户端下，本地周起点应不同于服务端 UTC 周起点');
  });

  test('all-range ~100天：week 分桶标签分歧，但 streak/ratings/totalPoints 不受时区影响（AC-2 仅图表序列受影响）', async () => {
    const fixture = buildFixture(100, '2026-07-10'); // 32<=100<=180 -> week 粒度
    // A：data-layer 真实代码，注入浏览器准确的 +8 本地 Date
    const ctxLocal = loadDataLayer({ cachedData: JSON.parse(JSON.stringify(fixture)) }, LocalPlus8Date);
    const A = ctxLocal.Data.computeStatsFromCachedData('all');
    // B：服务端 UTC 聚合 -> loadAdminStats 归一化
    const ctxSrv = loadDataLayer({ cachedData: JSON.parse(JSON.stringify(fixture)) });
    const raw = serverRawForRange('all', fixture);
    ctxSrv.API._fetch = async () => raw;
    const B = await ctxSrv.Data.loadAdminStats('all');

    // 1) 安全字段必须一致（与时区无关）
    assert.strictEqual(A.streak, B.streak, 'streak 全历史口径须一致');
    assert.deepStrictEqual(A.ratingCounts, B.ratingCounts, 'ratingCounts 须一致');
    assert.strictEqual(A.ratingTotal, B.ratingTotal, 'ratingTotal 须一致');
    assert.deepStrictEqual(A.ratingsList, B.ratingsList, 'ratingsList 须一致');
    assert.strictEqual(A.totalPoints, B.totalPoints, 'totalPoints(逐日求和) 须一致——周分桶只重排不丢日');

    // 2) week 分桶标签须分歧（风险确认）—— 用 JSON 字符串比较，避免依赖 assert.notDeepStrictEqual 是否可用
    const aLabels = A.totalMinutes.map((x) => x.date);
    const bLabels = B.totalMinutes.map((x) => x.date);
    const labelsIdentical = JSON.stringify(aLabels) === JSON.stringify(bLabels);
    assert.strictEqual(labelsIdentical, false, '非 UTC 客户端下 week 分桶标签须出现分歧（已知隐患）');

    // 3) 结论性：聚合后数值总和守恒（逐日求和跨周分桶不变）
    const sumA = A.totalMinutes.reduce((s, x) => s + x.value, 0);
    const sumB = B.totalMinutes.reduce((s, x) => s + x.value, 0);
    assert.strictEqual(sumA, sumB, 'week 聚合的逐日总用时之和须守恒');
  });
});
