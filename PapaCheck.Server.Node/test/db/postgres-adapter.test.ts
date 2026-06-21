import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];
const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe.runIf(runPg)('PostgresAdapter', () => {
  let adapter: any;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);

    // 确保测试租户存在
    await adapter.createTenant(TEST_TENANT_ID, '测试租户');

    // 插入该租户的单行表默认行
    const defaultRows = [
      { table: 'shop_items', data: '[]' },
      { table: 'redemptions', data: '[]' },
      { table: 'badges', data: '[]' },
      { table: 'reward_box', data: '[]' },
      { table: 'settings', data: '{}' },
      { table: 'active_buffs', data: '[]' },
      { table: 'bounty_tasks', data: '[]' },
      { table: 'email_config', data: '{}' },
    ];
    for (const { table, data } of defaultRows) {
      await adapter.pool.query(
        `INSERT INTO ${table} (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`,
        [TEST_TENANT_ID, data]
      );
    }
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, id, balance) VALUES ($1, 1, 0) ON CONFLICT DO NOTHING",
      [TEST_TENANT_ID]
    );
  });

  afterAll(async () => {
    await adapter?.close();
  });

  it('should get points balance', async () => {
    const balance = await adapter.getPointsBalance(TEST_TENANT_ID);
    expect(typeof balance).toBe('number');
  });

  it('should earn and spend points', async () => {
    const before = await adapter.getPointsBalance(TEST_TENANT_ID);
    await adapter.updatePoints('earn', 100, 'test earn', TEST_TENANT_ID);
    expect(await adapter.getPointsBalance(TEST_TENANT_ID)).toBe(before + 100);
    await adapter.updatePoints('spend', 50, 'test spend', TEST_TENANT_ID);
    expect(await adapter.getPointsBalance(TEST_TENANT_ID)).toBe(before + 50);
  });

  it('should store and retrieve homeworks', async () => {
    await adapter.saveHomeworks('2026-06-09', [{ id: 'hw1', subject: '数学' }], TEST_TENANT_ID);
    const items = await adapter.getHomeworks('2026-06-09', TEST_TENANT_ID);
    expect(items.length).toBe(1);
    expect(items[0].subject).toBe('数学');
  });

  it('should store and retrieve shop items', async () => {
    await adapter.saveShopItems([{ id: 'item1', name: '游戏时间', cost: 50 }], TEST_TENANT_ID);
    const items = await adapter.getShopItems(TEST_TENANT_ID);
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('游戏时间');
  });

  it('should store and retrieve settings', async () => {
    await adapter.saveSettings({ dailyBasePoints: 10 }, TEST_TENANT_ID);
    const settings = await adapter.getSettings(TEST_TENANT_ID);
    expect(settings.dailyBasePoints).toBe(10);
  });

  it('should handle full data snapshot', async () => {
    const data = await adapter.getFullData(TEST_TENANT_ID);
    expect(data).toHaveProperty('points');
    expect(data).toHaveProperty('homeworks');
    expect(data).toHaveProperty('shopItems');
    expect(data).toHaveProperty('settings');
  });

  it('should handle pushMerge', async () => {
    const result = await adapter.pushMerge([]);
    expect(result).toEqual({ ok: true });
  });

  it('should record and retrieve modifications', async () => {
    const now = new Date().toISOString();
    await adapter.recordModification('homeworks', '2026-06-09', now, TEST_TENANT_ID);
    const modified = await adapter.getModifiedSince('2000-01-01', TEST_TENANT_ID);
    expect(modified.length).toBeGreaterThanOrEqual(1);
  });
});
