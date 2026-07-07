import { initCloudBase, signInWithJwt, getDb, getCurrentTenantId, getCurrentChildId } from './cloudbase.js';

const SUBSCRIBED_TABLES = [
  'homeworks',
  'daily_settlement',
  'points',
  'points_history',
  'shop_items',
  'redemptions',
  'reward_box',
  'bounty_tasks',
  'bounty_submissions',
  'bounty_completions',
  'active_buffs',
  'efficiency_history',
  'free_time_tasks',
  'notifications',
];

export class RealtimeManager {
  constructor() {
    this.subscriptions = new Map();
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

  async start(jwtToken, tenantId, childId) {
    initCloudBase();
    await signInWithJwt(jwtToken);

    sessionStorage.setItem('papacheck_tenant_id', tenantId);
    if (childId) {
      sessionStorage.setItem('papacheck_child_id', childId);
    }

    for (const table of SUBSCRIBED_TABLES) {
      this.subscribe(table);
    }
  }

  subscribe(tableName) {
    const db = getDb();
    const callbackName = `on${tableName.charAt(0).toUpperCase() + tableName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Change`;
    const callback = this.callbacks[callbackName] || (() => {});

    const unsubscribe = db.table(tableName)
      .where('tenant_id', 'eq', getCurrentTenantId())
      .watch(callback);

    this.subscriptions.set(tableName, unsubscribe);
  }

  stop() {
    this.subscriptions.forEach((unsub) => {
      if (typeof unsub === 'function') unsub();
    });
    this.subscriptions.clear();
  }

  // 回调方法（由 app.js 设置具体逻辑）
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
