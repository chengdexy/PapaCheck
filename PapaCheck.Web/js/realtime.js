/**
 * realtime.js - 实时数据同步模块
 * 使用轮询方式获取数据更新，替代 CloudBase watch()
 */

const POLL_INTERVAL_MS = 30000;

export class RealtimeManager {
  constructor() {
    this.pollTimer = null;
    this.callbacks = {
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

  triggerAll() {
    for (const key of Object.keys(this.callbacks)) {
      try {
        this.callbacks[key]();
      } catch (e) {
        // ignore
      }
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