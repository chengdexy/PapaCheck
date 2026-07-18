/**
 * data-layer.js —— 模块化数据层（替代旧 cachedData 单一快照）。
 *
 * 设计：design-data-on-demand.md §C.2.1。
 * 职责：
 *  - 按 scope（config / day / stats / points / bounty）懒加载并内存缓存；
 *  - init() 拉取「落地视图」所需最小集（今天 day + 配置 + 积分余额 + 当前 stats range + 赏金 total）；
 *  - refreshActive() 仅重拉「当前视图」资源（FR-6），替代旧 refreshAllData 的全量语义。
 *
 * 本文件为纯原生 JS、零依赖。所有方法内部调用 api.js 的对应方法（全局 API）。
 * 具体 admin/app/big-screen 接线由前端迁移任务（T03/T04）补充，此处提供完整可运行骨架。
 *
 * 注意：统计聚合结果 StatsResult 的字段语义与旧前端渲染器完全一致，
 * 前端同事可直接将 Data.stats.get(range) 的返回值喂给现有图表渲染器。
 */
(function (global) {
  'use strict';

  const API = global.API;

  // 内存缓存：按 scope 分桶。
  const _cache = {
    config: {},
    day: {},
    stats: {},
    points: {},
    bounty: {},
  };

  // 当前激活（可见）视图所需的资源标记。refreshActive() 仅重拉这些。
  const _active = {
    dayDates: [],      // 当前视图需要的单日 date_key 列表（如今天 / admin 选定日）
    statsRange: null,   // 当前统计区间 'week' | 'month' | 'all'
  };

  function _isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 统一缓存读取：命中则直接返回缓存，未命中则调用 loader 并写入。
  function _cached(scope, key, loader) {
    if (Object.prototype.hasOwnProperty.call(_cache[scope], key)) {
      return Promise.resolve(_cache[scope][key]);
    }
    return Promise.resolve()
      .then(loader)
      .then((val) => {
        _cache[scope][key] = val;
        return val;
      });
  }

  function _invalidate(scope, key) {
    if (key === undefined) {
      _cache[scope] = {};
    } else {
      delete _cache[scope][key];
    }
  }

  const Data = {
    _cache,

    /**
     * 标记当前视图需要的单日资源（调用方在切换视图时设置）。
     * @param {string|string[]} dateKeys 单日 date_key 或数组。
     */
    setActiveDays(dateKeys) {
      _active.dayDates = Array.isArray(dateKeys) ? dateKeys.slice() : [dateKeys];
      return this;
    },

    /** 标记当前统计区间。 */
    setActiveStatsRange(range) {
      _active.statsRange = range || null;
      return this;
    },

    /**
     * 启动：拉取落地视图所需最小集。
     * 默认今天单日 + 全量配置 + 积分余额 + 当前 stats range + 赏金 total。
     */
    async init() {
      const today = (global.Util && typeof global.Util.dateKey === 'function')
        ? global.Util.dateKey(new Date())
        : (global.AdminUtil && typeof global.AdminUtil.dateKey === 'function'
          ? global.AdminUtil.dateKey(new Date())
          : _isoDate(new Date()));

      _active.dayDates = [today];
      _active.statsRange = _active.statsRange || 'week';

      await Promise.all([
        this.config.getShopItems(),
        this.config.getRedemptions(),
        this.config.getRewardBox(),
        this.config.getSettings(),
        this.config.getBountyTasks(),
        this.config.getActiveBuffs(),
        this.day.getHomeworks(today),
        this.day.getSettlement(today),
        this.day.getFreeTime(today),
        this.points.getBalance(),
        this.stats.get(_active.statsRange),
        this.bounty.getCompletionsTotal(),
      ]);
      return this;
    },

    /**
     * 版本戳变化后仅重拉「当前视图」资源（FR-6）。
     * 仅重拉：当前视图的单日资源 + 当前 stats range + 积分余额 + 赏金 total。
     * 配置类体量小且极少变，沿用缓存、不强制重拉。
     */
    async refreshActive() {
      const tasks = [];
      for (const d of _active.dayDates) {
        tasks.push(this.day.getHomeworks(d, true));
        tasks.push(this.day.getSettlement(d, true));
        tasks.push(this.day.getFreeTime(d, true));
      }
      if (_active.statsRange) {
        tasks.push(this.stats.get(_active.statsRange, true));
      }
      tasks.push(this.points.getBalance(true));
      tasks.push(this.bounty.getCompletionsTotal(true));
      await Promise.all(tasks);
      return this;
    },

    // ============ 配置资源（与天数无关，稳定） ============
    config: {
      getShopItems() { return _cached('config', 'shop', () => API.getShopItems()); },
      getRedemptions() { return _cached('config', 'redemptions', () => API.getRedemptions()); },
      getRewardBox() { return _cached('config', 'rewardBox', () => API.getRewardBox()); },
      getSettings() { return _cached('config', 'settings', () => API.getSettings()); },
      getBountyTasks() { return _cached('config', 'bountyTasks', () => API.getBountyTasks()); },
      getActiveBuffs() { return _cached('config', 'activeBuffs', () => API.getActiveBuffs()); },
      /** 失效缓存：传 key 仅删该配置，不传则清空全部配置缓存。 */
      invalidate(key) { _invalidate('config', key); },
    },

    // ============ 单日资源（点状，∝当日数据量） ============
    day: {
      getHomeworks(d, force) { const k = 'hw:' + d; if (force) _invalidate('day', k); return _cached('day', k, () => API.getHomeworks(d)); },
      getSettlement(d, force) { const k = 'ds:' + d; if (force) _invalidate('day', k); return _cached('day', k, () => API.getSettlement(d)); },
      getFreeTime(d, force) { const k = 'ft:' + d; if (force) _invalidate('day', k); return _cached('day', k, () => API.getFreeTime(d)); },
      getBountySubmissions(d, force) { const k = 'bs:' + d; if (force) _invalidate('day', k); return _cached('day', k, () => API.getBountySubmissions(d)); },
      /** 乐观写回：PUT 成功后再调用，仅更新本地缓存（持久化仍由现有 PUT 负责）。 */
      setSettlement(d, v) { _cache.day['ds:' + d] = v; },
      setHomeworks(d, v) { _cache.day['hw:' + d] = v; },
      setFreeTime(d, v) { _cache.day['ft:' + d] = v; },
      setBountySubmissions(d, v) { _cache.day['bs:' + d] = v; },
    },

    // ============ 聚合资源（跨天统计） ============
    stats: {
      /**
       * @param {string} range 'week' | 'month' | 'all'
       * @param {boolean} [force] 为 true 时跳过缓存强制重拉。
       * @returns {Promise<object>} StatsResult（字段语义与旧渲染器一致）
       */
      get(range, force) { if (force) _invalidate('stats', range); return _cached('stats', range, () => API.getStats(range)); },
      invalidate(range) { _invalidate('stats', range); },
    },

    // ============ 积分余额 ============
    points: {
      getBalance(force) { if (force) _invalidate('points', 'bal'); return _cached('points', 'bal', () => API.getPointsBalance()); },
      invalidate() { _invalidate('points', 'bal'); },
    },

    // ============ 赏金完成汇总 ============
    bounty: {
      getCompletionsTotal(force) { if (force) _invalidate('bounty', 'total'); return _cached('bounty', 'total', () => API.getBountyCompletionsTotal()); },
      invalidate() { _invalidate('bounty', 'total'); },
    },
  };

  // 暴露为全局 Data（兼 DataLayer 别名），供 admin/app/big-screen 通过 window.Data 访问。
  global.Data = Data;
  global.DataLayer = Data;

})(typeof window !== 'undefined' ? window : globalThis);
