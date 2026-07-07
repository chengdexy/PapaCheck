/**
 * realtime.js - 实时数据同步模块
 * 使用轮询方式获取数据更新，替代 CloudBase watch()
 */

const POLL_INTERVAL_MS = 30000;

export class RealtimeManager {
  constructor() {
    this.pollTimer = null;
    this.callbacks = {
      /** 轮询模式统一刷新回调（替代逐个触发） */
      onRefresh: () => {},
      /** 以下为细粒度回调，供 watch() 模式使用 */
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
    this.triggerAll();
    this.pollTimer = setInterval(() => this.triggerAll(), POLL_INTERVAL_MS);
  }

  /** 轮询触发：只调用一次统一刷新回调，避免重复请求 */
  triggerAll() {
    try {
      this.callbacks.onRefresh();
    } catch (e) {
      // ignore
    }
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
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