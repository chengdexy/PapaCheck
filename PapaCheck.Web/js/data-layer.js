/**
 * data-layer.js - 前端「数据按需获取」重构的数据层（单例）
 *
 * 职责：
 *  - 封装全部「按需端点」调用（点状 / 聚合 / 配置三类），按视图填充全局 cachedData 快照；
 *  - 聚合资源归一化为 StatsAgg，供 admin 统计页（renderStatsTab）消费；
 *  - 任一按需端点失败/超时（默认 8s）即回退 GET /api/data 全量，保证功能不退（AC-5）。
 *
 * 设计约束（详见架构设计文档 §3）：
 *  - 本文件为 classic <script>，挂在 window.Data，须在 api.js 之后、业务脚本之前加载；
 *  - cachedData 内存快照形状保持不变，Data 层只按视图填充（单日/配置消费点契约零改动）；
 *  - 不引入任何新依赖、无构建步骤；
 *  - 仅复用 api.js 现有 API.* 封装（及 API._fetch / API.API_BASE 内部通道）。
 *
 * 注意：cachedData / isServerMode 为 api.js 以顶层 let 声明的全局词法绑定，
 * 在本文件直接以裸标识符读写即可（与 app.js / admin.js 共享同一全局词法环境）。
 */

(function () {
  'use strict';

  // ========== 内部状态 ==========
  let _entry = null;                              // 'child' | 'admin' | 'bigscreen'
  const _statsCache = {};                        // range -> StatsAgg（loadAdminStats 缓存）
  let _bountyTotal = {};                         // { [taskId]: number }（/api/bounty-completions/total）
  let _identity = { tenant_id: null, child_id: null };
  const FALLBACK_TIMEOUT_MS = 8000;              // 按需端点超时阈值（架构 §8）

  // ========== cachedData 快照读写（直接操作 api.js 全局词法绑定） ==========
  function _getSnapshot() {
    // 直接引用 api.js 顶层 let cachedData（跨 script 共享）
    /* eslint-disable no-undef */
    return typeof cachedData !== 'undefined' ? cachedData : null;
    /* eslint-enable no-undef */
  }

  function _setSnapshot(data) {
    /* eslint-disable no-undef */
    cachedData = data;
    /* eslint-enable no-undef */
  }

  function _getIsServerMode() {
    /* eslint-disable no-undef */
    return typeof isServerMode !== 'undefined' ? isServerMode : false;
    /* eslint-enable no-undef */
  }

  function _setIsServerMode(v) {
    /* eslint-disable no-undef */
    isServerMode = v;
    /* eslint-enable no-undef */
  }

  /**
   * 确保 cachedData 为合法对象且各子结构存在，避免按 dateKey 填充时抛错。
   * @returns {object} cachedData 快照
   */
  function _ensureSnapshot() {
    let snap = _getSnapshot();
    if (!snap || typeof snap !== 'object') {
      snap = _emptySnapshot();
      _setSnapshot(snap);
    }
    if (!snap.homeworks) snap.homeworks = {};
    if (!snap.dailySettlement) snap.dailySettlement = {};
    if (!snap.freeTimeTasks) snap.freeTimeTasks = {};
    if (!snap.bountySubmissions) snap.bountySubmissions = {};
    if (!snap.bountyCompletions) snap.bountyCompletions = { _total: {} };
    if (!snap.shopItems) snap.shopItems = [];
    if (!snap.redemptions) snap.redemptions = [];
    if (!snap.rewardBox) snap.rewardBox = [];
    if (!snap.bountyTasks) snap.bountyTasks = [];
    if (!snap.activeBuffs) snap.activeBuffs = [];
    if (!snap.settings) snap.settings = {};
    if (!snap.points) snap.points = { balance: 0 };
    return snap;
  }

  function _emptySnapshot() {
    return {
      homeworks: {},
      dailySettlement: {},
      freeTimeTasks: {},
      bountySubmissions: {},
      bountyCompletions: { _total: {} },
      shopItems: [],
      redemptions: [],
      rewardBox: [],
      bountyTasks: [],
      activeBuffs: [],
      settings: {},
      points: { balance: 0 },
      tenant_id: null,
      child_id: null,
    };
  }

  // ========== 身份（JWT 解码） ==========
  /**
   * 从 sessionStorage.papacheck_token 解码 JWT 取 tenant_id / child_id。
   * 由于按需路径不再拉全量 /api/data，bootstrap 必须自行解析 JWT 填充身份，
   * 供 RealtimeManager.start 使用（AC-6 沿用既有 JWT 隔离）。
   */
  function _decodeIdentity() {
    try {
      /* eslint-disable no-undef */
      const token = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('papacheck_token') : null;
      /* eslint-enable no-undef */
      if (!token) return { tenant_id: null, child_id: null };
      const parts = token.split('.');
      if (parts.length < 2) return { tenant_id: null, child_id: null };
      let payloadStr = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payloadStr.length % 4) payloadStr += '=';
      const bin = (typeof atob !== 'undefined') ? atob(payloadStr) : null;
      if (!bin) return { tenant_id: null, child_id: null };
      const json = decodeURIComponent(
        bin.split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')
      );
      const payload = JSON.parse(json);
      return {
        tenant_id: payload.tenant_id || null,
        child_id: payload.child_id || payload.childId || null,
      };
    } catch (e) {
      return { tenant_id: null, child_id: null };
    }
  }

  // ========== 统一降级包装 ==========
  /**
   * 运行 fn；若抛错或 8s 超时，则回退 GET /api/data 全量（不向上抛未捕获异常）。
   * 注：API._fetch 暂未支持 AbortSignal，超时通过 Promise.race 触发降级，
   * 底层请求可能在后台继续但无副作用。
   */
  async function _withFallback(fn) {
    let timer = null;
    let timedOut = false;
    const timeoutPromise = new Promise(function (_, reject) {
      timer = setTimeout(function () { timedOut = true; reject(new Error('Data request timeout')); }, FALLBACK_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      if (!timedOut) {
        console.warn('[Data] 按需端点失败，已回退 /api/data', err);
      } else {
        console.warn('[Data] 按需端点超时（' + FALLBACK_TIMEOUT_MS + 'ms），已回退 /api/data');
      }
      await fallbackToFullCachedData();
      return null;
    }
  }

  // ========== 降级：回退全量 /api/data ==========
  /**
   * 任一按需端点失败/超时触发：GET /api/data 填 cachedData 全量，
   * 并重算 _bountyTotal（使 Data.getBountyTotal() 在降级后仍可用）。
   */
  async function fallbackToFullCachedData() {
    try {
      /* eslint-disable no-undef */
      const data = await API.getData();
      /* eslint-enable no-undef */
      if (data) {
        _setSnapshot(data);
        _setIsServerMode(true);
        const snap = _getSnapshot();
        if (!snap.tenant_id && _identity.tenant_id) snap.tenant_id = _identity.tenant_id;
        if (!snap.child_id && _identity.child_id) snap.child_id = _identity.child_id;
        _recomputeBountyTotalFromSnapshot();
      }
    } catch (e) {
      console.warn('[Data] 降级 /api/data 也失败，保留现有快照', e);
    }
  }

  /** 从全量 bountyCompletions（按天结构）重算 _total，供 getBountyTotal() 使用 */
  function _recomputeBountyTotalFromSnapshot() {
    const snap = _getSnapshot();
    const total = {};
    if (!snap || !snap.bountyCompletions) { _bountyTotal = total; return; }
    const SKIP = { uuid: 1, lastModified: 1, isDeleted: 1, _table: 1, date: 1, _total: 1 };
    for (const dk of Object.keys(snap.bountyCompletions)) {
      if (dk === '_total') continue;
      const entry = snap.bountyCompletions[dk];
      if (entry && typeof entry === 'object') {
        for (const tid of Object.keys(entry)) {
          if (SKIP[tid]) continue;
          const v = entry[tid];
          const delta = typeof v === 'number' ? v : (v ? 1 : 0);
          total[tid] = (total[tid] || 0) + delta;
        }
      }
    }
    _bountyTotal = total;
    snap.bountyCompletions._total = total;
  }

  // ========== 日期键辅助 ==========
  function _todayKey() {
    /* eslint-disable no-undef */
    if (typeof Util !== 'undefined' && Util && typeof Util.dateKey === 'function') {
      return Util.dateKey(currentDate);
    }
    const d = (typeof currentDate !== 'undefined' && currentDate) ? currentDate : new Date();
    /* eslint-enable no-undef */
    return _formatYmd(d);
  }

  function _adminDateKey() {
    /* eslint-disable no-undef */
    if (typeof AdminUtil !== 'undefined' && AdminUtil && typeof AdminUtil.dateKey === 'function') {
      return AdminUtil.dateKey(adminDate);
    }
    const d = (typeof adminDate !== 'undefined' && adminDate) ? adminDate : new Date();
    /* eslint-enable no-undef */
    return _formatYmd(d);
  }

  function _statsRangeForAdmin() {
    /* eslint-disable no-undef */
    return (typeof _statsRange !== 'undefined' && _statsRange) ? _statsRange : 'week';
    /* eslint-enable no-undef */
  }

  function _formatYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ========== 单日 / 点状资源 ==========

  /** 孩子端单日：homeworks + settlement + freetime + bountySubmissions */
  async function loadChildDay(dateKey) {
    await _withFallback(async function () {
      /* eslint-disable no-undef */
      const [hw, st, ft, bs] = await Promise.all([
        API.getHomeworks(dateKey),
        API.getSettlement(dateKey),
        API.getFreeTime(dateKey),
        API.getBountySubmissions(dateKey),
      ]);
      /* eslint-enable no-undef */
      const snap = _ensureSnapshot();
      if (hw !== undefined && hw !== null) snap.homeworks[dateKey] = hw;
      if (st !== undefined && st !== null) snap.dailySettlement[dateKey] = st;
      if (ft !== undefined && ft !== null) snap.freeTimeTasks[dateKey] = ft;
      if (bs !== undefined && bs !== null) snap.bountySubmissions[dateKey] = bs;
    });
  }

  /** 家长端单日（作业/赏金 tab）：bountySubmissions + homeworks */
  async function loadAdminDay(dateKey) {
    await _withFallback(async function () {
      /* eslint-disable no-undef */
      const [bs, hw] = await Promise.all([
        API.getBountySubmissions(dateKey),
        API.getHomeworks(dateKey),
      ]);
      /* eslint-enable no-undef */
      const snap = _ensureSnapshot();
      if (bs !== undefined && bs !== null) snap.bountySubmissions[dateKey] = bs;
      if (hw !== undefined && hw !== null) snap.homeworks[dateKey] = hw;
    });
  }

  /** 大屏单日：settlement + homeworks + freetime */
  async function loadBigScreenDay(dateKey) {
    await _withFallback(async function () {
      /* eslint-disable no-undef */
      const [st, hw, ft] = await Promise.all([
        API.getSettlement(dateKey),
        API.getHomeworks(dateKey),
        API.getFreeTime(dateKey),
      ]);
      /* eslint-enable no-undef */
      const snap = _ensureSnapshot();
      if (st !== undefined && st !== null) snap.dailySettlement[dateKey] = st;
      if (hw !== undefined && hw !== null) snap.homeworks[dateKey] = hw;
      if (ft !== undefined && ft !== null) snap.freeTimeTasks[dateKey] = ft;
    });
  }

  // ========== 聚合资源 ==========

  /** 家长端统计：GET /api/stats?range 归一化为 StatsAgg；失败回退全量 */
  async function loadAdminStats(range) {
    range = range || 'week';
    try {
      /* eslint-disable no-undef */
      const raw = await API._fetch(API.API_BASE + '/stats?range=' + encodeURIComponent(range));
      /* eslint-enable no-undef */
      const stats = _normalizeStats(raw, range);
      _statsCache[range] = stats;
      return stats;
    } catch (e) {
      console.warn('[Data] 统计聚合端点失败，已回退 /api/data', e);
      await fallbackToFullCachedData();
      const stats = _computeStatsFromCachedData(range);
      _statsCache[range] = stats;
      return stats;
    }
  }

  /** 赏金累计：GET /api/bounty-completions/total */
  async function loadBountyCompletionsTotal() {
    try {
      /* eslint-disable no-undef */
      const total = await API._fetch(API.API_BASE + '/bounty-completions/total');
      /* eslint-enable no-undef */
      _bountyTotal = (total && typeof total === 'object') ? total : {};
      const snap = _ensureSnapshot();
      if (!snap.bountyCompletions) snap.bountyCompletions = {};
      snap.bountyCompletions._total = _bountyTotal;
    } catch (e) {
      console.warn('[Data] 赏金累计端点失败，已回退 /api/data', e);
      await fallbackToFullCachedData();
    }
  }

  // ========== 配置资源（并行，一次性） ==========
  /** 并行 GET 配置端点，填充 cachedData 配置字段；单端点失败仅跳过，不触发全量回退 */
  async function loadConfig() {
    const snap = _ensureSnapshot();
    const jobs = [
      ['shopItems', function () { /* eslint-disable no-undef */ return API.getShopItems(); /* eslint-enable no-undef */ }],
      ['redemptions', function () { /* eslint-disable no-undef */ return API.getRedemptions(); /* eslint-enable no-undef */ }],
      ['rewardBox', function () { /* eslint-disable no-undef */ return API.getRewardBox(); /* eslint-enable no-undef */ }],
      ['bountyTasks', function () { /* eslint-disable no-undef */ return API.getBountyTasks(); /* eslint-enable no-undef */ }],
      ['activeBuffs', function () { /* eslint-disable no-undef */ return API.getActiveBuffs(); /* eslint-enable no-undef */ }],
      ['settings', function () { /* eslint-disable no-undef */ return API.getSettings(); /* eslint-enable no-undef */ }],
      ['points', function () { /* eslint-disable no-undef */ return API.getPointsBalance(); /* eslint-enable no-undef */ }],
    ];
    await Promise.all(jobs.map(async function (pair) {
      const key = pair[0];
      const fn = pair[1];
      try {
        const data = await fn();
        if (data === undefined || data === null) return;
        if (key === 'points') {
          const bal = (data && typeof data.balance === 'number')
            ? data.balance
            : (typeof data === 'number' ? data : 0);
          snap.points = { balance: bal };
        } else {
          snap[key] = data;
        }
      } catch (e) {
        console.warn('[Data] 配置端点失败（已跳过，保留既有值）: ' + key, e);
      }
    }));
  }

  // ========== 实时刷新：最小集 ==========
  /** 依据 _entry + 当前视图重拉最小集（替代全量重拉，达成 AC-1/AC-4） */
  async function refreshCurrentView() {
    if (_entry === 'child') {
      await loadChildDay(_todayKey());
      return;
    }
    if (_entry === 'admin') {
      const tab = _currentAdminTab();
      if (tab === 'stats') {
        await Promise.all([loadAdminStats(_statsRangeForAdmin()), loadBountyCompletionsTotal()]);
      } else if (tab === 'bounty' || tab === 'homework') {
        await loadAdminDay(_adminDateKey());
      } else {
        // 设置/商店/奖励箱/兑换 tab：配置已在 bootstrap 加载，写操作已本地乐观更新 → 跳过
        return;
      }
      return;
    }
    if (_entry === 'bigscreen') {
      await loadConfig();
      return;
    }
    // _entry 未设置（理论上不应发生）：保守回退为加载配置
    if (!_entry) {
      await loadConfig();
    }
  }

  function _currentAdminTab() {
    /* eslint-disable no-undef */
    return (typeof adminCurrentTab !== 'undefined' && adminCurrentTab) ? adminCurrentTab : 'homework';
    /* eslint-enable no-undef */
  }

  // ========== 初始化（替代各端 init 的 await API.getData()） ==========
  /**
   * 初始化：解码身份 + 置 isServerMode + 并行加载配置与当前视图单日数据。
   * @param {('child'|'admin'|'bigscreen')} entry
   * @param {object} [opts]
   */
  async function bootstrap(entry, opts) {
    _entry = entry;
    const identity = _decodeIdentity();
    _identity = identity;
    const snap = _ensureSnapshot();
    if (identity.tenant_id) snap.tenant_id = identity.tenant_id;
    if (identity.child_id) snap.child_id = identity.child_id;
    _setIsServerMode(true);

    const tasks = [loadConfig()];
    if (entry === 'child') tasks.push(loadChildDay(_todayKey()));
    else if (entry === 'bigscreen') tasks.push(loadBigScreenDay(_todayKey()));
    else if (entry === 'admin') tasks.push(loadAdminDay(_adminDateKey()));

    await Promise.allSettled(tasks);
    return;
  }

  // ========== StatsAgg 归一化（服务端 → 前端契约） ==========
  /**
   * 将服务端 /api/stats 响应归一化为 StatsAgg。
   * 服务端 aggregation 已返回显示粒度序列（{label, value}），此处将其映射为契约要求的 {date, value}。
   * streak 须为全历史口径：服务端已用 allDates 计算；若缺失则本地兜底。
   */
  function _normalizeStats(raw, range) {
    if (!raw) return _emptyStats(range);
    const mapDateValue = function (arr) {
      return (arr || []).map(function (d) { return { date: d.label, value: d.value }; });
    };
    const completedInSchool = (raw.completedInSchool || []).map(function (d) {
      return { date: d.label, inSchool: d.inSchool, atHome: d.atHome };
    });
    const ratingsList = (raw.ratingsList || []).map(function (d) {
      return {
        date: d.date,
        rating: d.rating,
        totalBeforeRating: d.totalBeforeRating,
        multiplier: d.multiplier,
        finalPoints: d.finalPoints,
      };
    });
    const ratingCounts = raw.ratingCounts || { '优': 0, '良': 0, '可': 0, '差': 0 };

    // streak 兜底：服务端未返回有效值则按全历史本地计算
    let streak = (typeof raw.streak === 'number') ? raw.streak : null;
    if (streak === null) {
      const snap = _getSnapshot() || {};
      streak = _calcStreak(Object.keys(snap.dailySettlement || {}).sort(), snap.dailySettlement || {});
    }

    return {
      range: range,
      groupMode: raw.groupMode || 'day',
      // dateCount：day 粒度时聚合序列长度==天数（精确）；week/month 粒度时为最佳估计（AC-2 比对不含此显示字段）
      dateCount: (raw.totalMinutes || []).length,
      totalMinutes: mapDateValue(raw.totalMinutes),
      efficiencyRatios: mapDateValue(raw.efficiencyRatios),
      dailyPoints: mapDateValue(raw.dailyPoints),
      completedInSchool: completedInSchool,
      ratingCounts: ratingCounts,
      ratingTotal: raw.ratingTotal || 0,
      ratingsList: ratingsList,
      streak: streak,
      avgTotalMin: raw.avgTotalMin || 0,
      avgEffVal: raw.avgEffVal || 0,
      totalPoints: raw.totalPoints || 0,
    };
  }

  function _emptyStats(range) {
    return {
      range: range || 'week',
      groupMode: 'day',
      dateCount: 0,
      totalMinutes: [],
      efficiencyRatios: [],
      dailyPoints: [],
      completedInSchool: [],
      ratingCounts: { '优': 0, '良': 0, '可': 0, '差': 0 },
      ratingTotal: 0,
      ratingsList: [],
      streak: 0,
      avgTotalMin: 0,
      avgEffVal: 0,
      totalPoints: 0,
    };
  }

  // ========== 本地聚合（legacy 算法抽取，供 fallback + QA 回归基线） ==========
  // 以下函数与服务端 buildStatsFromData 逐字节等价（已实测核对 handler-body.js）。
  // 周分桶改用 UTC 口径（_getWeekStart/_formatWeekLabel），与服务端完全一致，
  // 消除降级路径在 range='all' 且历史 32–180 天时因时区差导致的 ≤1 天周标签偏移。

  function _getGroupMode(dateCount, range) {
    if (range !== 'all') return 'day';
    if (dateCount <= 31) return 'day';
    if (dateCount <= 180) return 'week';
    return 'month';
  }

  function _parseYmd(s) {
    const parts = s.split('-');
    return { y: +parts[0], m: +parts[1], d: +parts[2] };
  }

  function _getWeekStart(dateStr) {
    const { y, m, d } = _parseYmd(dateStr);
    const base = new Date(Date.UTC(y, m - 1, d));
    const day = base.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(base.getTime() - diffToMonday * 864e5);
    const yy = monday.getUTCFullYear();
    const mm = String(monday.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(monday.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  function _formatWeekLabel(key) {
    const { y, m, d } = _parseYmd(key);
    const start = new Date(Date.UTC(y, m - 1, d));
    const end = new Date(start.getTime() + 6 * 864e5);
    const fmt = (dt) => `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
    return `${fmt(start)}-${fmt(end)}`;
  }

  function _aggregateDaily(data, groupMode, mode) {
    if (!data.length) return [];
    if (groupMode === 'day') return data.map(function (d) { return { label: d.date.slice(5), value: d.value }; });
    const groups = {};
    data.forEach(function (d) {
      const key = groupMode === 'week' ? _getWeekStart(d.date) : d.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return Object.entries(groups).map(function (pair) {
      const key = pair[0];
      const items = pair[1];
      const sum = items.reduce(function (s, d) { return s + d.value; }, 0);
      const value = mode === 'mean' ? Math.round(sum / items.length) : Math.round(sum);
      return { label: groupMode === 'week' ? _formatWeekLabel(key) : key, value: value };
    });
  }

  function _aggregateCompletionData(data, groupMode) {
    if (!data.length) return [];
    if (groupMode === 'day') return data.map(function (d) {
      return { label: d.date.slice(5), inSchool: d.inSchool, atHome: d.atHome };
    });
    const groups = {};
    data.forEach(function (d) {
      const key = groupMode === 'week' ? _getWeekStart(d.date) : d.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return Object.entries(groups).map(function (pair) {
      const key = pair[0];
      const items = pair[1];
      const inSchool = items.reduce(function (s, d) { return s + d.inSchool; }, 0);
      const atHome = items.reduce(function (s, d) { return s + d.atHome; }, 0);
      return { label: groupMode === 'week' ? _formatWeekLabel(key) : key, inSchool: inSchool, atHome: atHome };
    });
  }

  function _calcStreak(allDates, settlementByDate) {
    if (!allDates || allDates.length === 0) return 0;
    const sorted = [].concat(allDates).sort().reverse();
    let streak = 0;
    let started = false;
    for (const dk of sorted) {
      const s = settlementByDate ? settlementByDate[dk] : null;
      if (s && s.rating && s.rating !== '差') {
        streak++;
        started = true;
      } else if (started) {
        break;
      }
    }
    return streak;
  }

  /**
   * 从全量 cachedData 计算 StatsAgg（legacy 算法，与现状 admin.js renderStatsTab 逐字节一致）。
   * 用于：① loadAdminStats 服务端失败时的降级；② QA 回归基线（T9，与 /api/stats 比对）。
   * @param {('week'|'month'|'all')} range
   * @returns {StatsAgg}
   */
  function _computeStatsFromCachedData(range) {
    range = range || 'week';
    const snap = _getSnapshot() || {};
    const allDates = Object.keys(snap.dailySettlement || {}).sort();
    const maxDays = range === 'month' ? 30 : range === 'week' ? 7 : 9999;
    const dateRange = maxDays >= 9999 ? allDates : allDates.slice(-maxDays);
    const groupMode = _getGroupMode(dateRange.length, range);

    const totalMinData = [];
    const effRatioData = [];
    const dailyPointsData = [];
    dateRange.forEach(function (date) {
      const hwList = (snap.homeworks && snap.homeworks[date]) || [];
      const doneHw = hwList.filter(function (h) { return h.status === 'done' && !h.rejected; });
      const totalMin = doneHw.reduce(function (sum, h) { return sum + (h.actualDuration || 0); }, 0);
      totalMinData.push({ date: date, value: totalMin });
      const effHw = doneHw.filter(function (h) { return h.suggestedDuration > 0 && h.actualDuration !== null; });
      const ratios = effHw.map(function (h) { return h.suggestedDuration / h.actualDuration; });
      const avgRatio = ratios.length > 0 ? Math.round(ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length * 100) : 0;
      effRatioData.push({ date: date, value: avgRatio });
      const settlement = snap.dailySettlement ? snap.dailySettlement[date] : null;
      dailyPointsData.push({ date: date, value: settlement ? (settlement.finalPoints != null ? settlement.finalPoints : 0) : 0 });
    });

    const totalMinutes = _aggregateDaily(totalMinData, groupMode, 'mean');
    const efficiencyRatios = _aggregateDaily(effRatioData, groupMode, 'mean');
    const dailyPoints = _aggregateDaily(dailyPointsData, groupMode);

    const ratingsListDates = dateRange.filter(function (d) {
      return snap.dailySettlement && snap.dailySettlement[d] && snap.dailySettlement[d].rating;
    }).reverse();
    const ratingCounts = {};
    ratingsListDates.forEach(function (d) {
      const r = snap.dailySettlement[d].rating;
      if (r) ratingCounts[r] = (ratingCounts[r] || 0) + 1;
    });
    const ratingTotal = Object.keys(ratingCounts).reduce(function (s, k) { return s + ratingCounts[k]; }, 0);

    const completedInSchoolBarData = [];
    dateRange.forEach(function (date) {
      const hwList = (snap.homeworks && snap.homeworks[date]) || [];
      const doneHw = hwList.filter(function (h) { return h.status === 'done' && !h.rejected; });
      const inSchool = doneHw.filter(function (h) { return h.completedInSchool; }).length;
      const atHome = doneHw.length - inSchool;
      completedInSchoolBarData.push({ date: date, inSchool: inSchool, atHome: atHome });
    });
    const completedInSchool = _aggregateCompletionData(completedInSchoolBarData, groupMode);

    const ratingsList = ratingsListDates.map(function (d) {
      const s = snap.dailySettlement[d];
      return {
        date: d,
        rating: s.rating,
        totalBeforeRating: s.totalBeforeRating,
        multiplier: s.multiplier,
        finalPoints: s.finalPoints,
      };
    });

    const streak = _calcStreak(allDates, snap.dailySettlement || {});
    const avgTotalMin = totalMinutes.length > 0
      ? Math.round(totalMinutes.reduce(function (a, b) { return a + b.value; }, 0) / totalMinutes.length)
      : 0;
    const avgEff = efficiencyRatios.filter(function (e) { return e.value > 0; });
    const avgEffVal = avgEff.length > 0
      ? Math.round(avgEff.reduce(function (a, b) { return a + b.value; }, 0) / avgEff.length)
      : 0;
    const totalPoints = dailyPoints.reduce(function (a, b) { return a + b.value; }, 0);

    // 映射 label -> date（满足 StatsAgg 契约）
    const mapDateValue = function (arr) { return arr.map(function (d) { return { date: d.label, value: d.value }; }); };
    const completedInSchoolOut = completedInSchool.map(function (d) {
      return { date: d.label, inSchool: d.inSchool, atHome: d.atHome };
    });

    return {
      range: range,
      groupMode: groupMode,
      dateCount: totalMinutes.length,
      totalMinutes: mapDateValue(totalMinutes),
      efficiencyRatios: mapDateValue(efficiencyRatios),
      dailyPoints: mapDateValue(dailyPoints),
      completedInSchool: completedInSchoolOut,
      ratingCounts: ratingCounts,
      ratingTotal: ratingTotal,
      ratingsList: ratingsList,
      streak: streak,
      avgTotalMin: avgTotalMin,
      avgEffVal: avgEffVal,
      totalPoints: totalPoints,
    };
  }

  // ========== 公开 API ==========
  const Data = {
    bootstrap: bootstrap,
    loadChildDay: loadChildDay,
    loadAdminDay: loadAdminDay,
    loadBigScreenDay: loadBigScreenDay,
    loadAdminStats: loadAdminStats,
    loadBountyCompletionsTotal: loadBountyCompletionsTotal,
    loadConfig: loadConfig,
    refreshCurrentView: refreshCurrentView,
    fallbackToFullCachedData: fallbackToFullCachedData,
    getSnapshot: _getSnapshot,
    getStats: function (range) { return _statsCache[range] || null; },
    getBountyTotal: function () { return _bountyTotal; },
    // 暴露给 QA 回归（T9）：legacy 聚合基线，与 /api/stats 归一化结果逐项比对
    computeStatsFromCachedData: _computeStatsFromCachedData,
  };

  if (typeof window !== 'undefined') {
    window.Data = Data;
  }
  // 同时挂到全局词法环境，便于其他 classic script 以裸标识符 Data 访问
  if (typeof globalThis !== 'undefined') {
    globalThis.Data = Data;
  }
})();
