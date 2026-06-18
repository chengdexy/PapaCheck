import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('PostgresAdapter', () => {
  let adapter: any;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
  });

  afterAll(async () => {
    await adapter?.close();
  });

  it('should get points balance', async () => {
    const balance = await adapter.getPointsBalance();
    expect(typeof balance).toBe('number');
  });

  it('should earn and spend points', async () => {
    const before = await adapter.getPointsBalance();
    await adapter.updatePoints('earn', 100, 'test earn');
    expect(await adapter.getPointsBalance()).toBe(before + 100);
    await adapter.updatePoints('spend', 50, 'test spend');
    expect(await adapter.getPointsBalance()).toBe(before + 50);
  });

  it('should store and retrieve homeworks', async () => {
    await adapter.saveHomeworks('2026-06-09', [{ id: 'hw1', subject: '数学' }]);
    const items = await adapter.getHomeworks('2026-06-09');
    expect(items.length).toBe(1);
    expect(items[0].subject).toBe('数学');
  });

  it('should store and retrieve shop items', async () => {
    await adapter.saveShopItems([{ id: 'item1', name: '游戏时间', cost: 50 }]);
    const items = await adapter.getShopItems();
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('游戏时间');
  });

  it('should store and retrieve settings', async () => {
    await adapter.saveSettings({ dailyBasePoints: 10 });
    const settings = await adapter.getSettings();
    expect(settings.dailyBasePoints).toBe(10);
  });

  it('should handle full data snapshot', async () => {
    const data = await adapter.getFullData();
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
    await adapter.recordModification('homeworks', '2026-06-09', now);
    const modified = await adapter.getModifiedSince('2000-01-01');
    expect(modified.length).toBeGreaterThanOrEqual(1);
  });
});
