/**
 * realtime.js - 实时数据同步模块
 *
 * 条件短轮询：每隔数秒轮询轻量版本戳端点 /api/data-version，
 * 仅当版本戳变化时才触发一次全量刷新（onRefresh）。
 * 相比旧的「30s 全量轮询」，延迟从最坏 30s 降到 ~3s，
 * 且 99% 的轮询只传输几十字节的版本戳，不再无脑拉全量。
 *
 * 额外优化：
 *  - burst 提速：本端写操作后短时间内提高轮询频率，快速拿到服务端派生结果；
 *  - 后台降频：页面不可见时降低轮询频率，节省资源与流量。
 */

const POLL_INTERVAL_MS = 3000;      // 前台基础轮询间隔
const HIDDEN_INTERVAL_MS = 15000;   // 页面不可见时的降频间隔
const BURST_INTERVAL_MS = 1000;     // burst 提速期间的轮询间隔
const BURST_DURATION_MS = 6000;     // burst 提速持续时长

export class RealtimeManager {
  constructor() {
    this.pollTimer = null;
    this.running = false;
    this.lastVersion = null;   // 上次看到的版本戳
    this.burstUntil = 0;       // burst 提速截止时间(ms)
    this.checking = false;     // 版本检查防重入
    this._onVisibility = null;
    this.callbacks = {
      /** 轮询模式统一刷新回调（版本戳变化时触发） */
      onRefresh: () => {},
      /** 以下为细粒度回调，供旧 watch() 模式兼容保留 */
      onHomeworksChange: () => {},
      onSettlementChange: () => {},
      onPointsChange: () => {},
      onPointsHistoryChange: () => {},
      onShopItemsChange: () => {},
      onRedemptionsChange: () => {},
      onRewardBoxChange: () => {},
      onBountyTasksChange: () => {},
      onBountySubmissionsChange: () => {},
      onBountyCompletionsChange: () => {},
      onActiveBuffsChange: () => {},
      onEfficiencyHistoryChange: () => {},
      onFreeTimeTasksChange: () => {},
      onNotificationsChange: () => {},
    };
  }

  async start(tenantId, childId) {
    sessionStorage.setItem('papacheck_tenant_id', tenantId);
    if (childId) {
      sessionStorage.setItem('papacheck_child_id', childId);
    }
    this.running = true;

    // 先记录当前版本戳作为基线（避免与随后的全量刷新产生竞态而漏掉变更）
    try {
      const res = await this._fetchVersion();
      this.lastVersion = res;
    } catch (e) {
      this.lastVersion = null;
    }

    // 启动时立即做一次全量刷新，拿到最新状态
    this._fireRefresh();

    // 监听页面可见性变化，切回前台时立即检查一次
    if (typeof document !== 'undefined') {
      this._onVisibility = () => {
        if (!document.hidden) this._reschedule(0);
      };
      document.addEventListener('visibilitychange', this._onVisibility);
    }

    this._scheduleNext();
  }

  /** 拉取版本戳，返回字符串或 null */
  async _fetchVersion() {
    const api = (typeof window !== 'undefined') ? window.API : null;
    if (!api || typeof api.getDataVersion !== 'function') return null;
    const res = await api.getDataVersion();
    return res ? res.version : null;
  }

  _fireRefresh() {
    try {
      this.callbacks.onRefresh();
    } catch (e) {
      // ignore
    }
  }

  /** 根据当前状态（burst / 后台 / 正常）返回下次轮询间隔 */
  _currentInterval() {
    if (Date.now() < this.burstUntil) return BURST_INTERVAL_MS;
    if (typeof document !== 'undefined' && document.hidden) return HIDDEN_INTERVAL_MS;
    return POLL_INTERVAL_MS;
  }

  _scheduleNext() {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this._tick(), this._currentInterval());
  }

  _reschedule(delay) {
    if (!this.running) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this._tick(), delay);
  }

  async _tick() {
    if (!this.running) return;
    await this._checkVersion();
    this._scheduleNext();
  }

  /** 检查版本戳，只有变化时才触发全量刷新 */
  async _checkVersion() {
    if (this.checking) return;
    this.checking = true;
    try {
      const v = await this._fetchVersion();
      if (v !== this.lastVersion) {
        this.lastVersion = v;
        this._fireRefresh();
      }
    } catch (e) {
      // 网络错误忽略，下一轮重试
    } finally {
      this.checking = false;
    }
  }

  /**
   * 本端写操作成功后调用：进入 burst 提速窗口，并尽快检查一次。
   * 让本端快速拿到服务端派生结果（如积分重算），也缩短整体感知延迟。
   */
  bump() {
    this.burstUntil = Date.now() + BURST_DURATION_MS;
    // 稍等片刻让服务端写入落库，再检查版本
    this._reschedule(200);
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this._onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._onVisibility = null;
    }
  }

  /** 兼容旧接口：立即触发一次全量刷新 */
  triggerAll() {
    this._fireRefresh();
  }

  onHomeworksChange(change) {}
  onSettlementChange(change) {}
  onPointsChange(change) {}
  onPointsHistoryChange(change) {}
  onShopItemsChange(change) {}
  onRedemptionsChange(change) {}
  onRewardBoxChange(change) {}
  onBountyTasksChange(change) {}
  onBountySubmissionsChange(change) {}
  onBountyCompletionsChange(change) {}
  onActiveBuffsChange(change) {}
  onEfficiencyHistoryChange(change) {}
  onFreeTimeTasksChange(change) {}
  onNotificationsChange(change) {}
}
