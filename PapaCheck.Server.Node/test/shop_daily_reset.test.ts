import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from '../src/db/index.js';

describe('商店每日数量重置保护', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'papacheck-test-shop-reset-'));
    dbPath = join(tmpDir, 'test.db');
    db = new Database(dbPath);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    const dir = dbPath.substring(0, dbPath.lastIndexOf('\\'));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('每日重置后 putShopItem 收到旧数据不覆盖重置值', () => {
    const items = [
      { id: 's1', name: '零食', baseQuantity: 3, remainingQuantity: 0, createdAt: Date.now() },
    ];
    db.saveShopItems(items);

    // 将 last_shop_reset 设为昨天，模拟日期变更
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    (db as any).db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)"
    ).run(yesterday);

    // 触发重置
    const resetResult = db.getShopItems();
    expect(resetResult.find((r: any) => r.id === 's1').remainingQuantity).toBe(3);

    // 模拟陈旧客户端推送（包含 old remainingQuantity 和 old lastModified）
    const staleData = {
      id: 's1',
      name: '零食',
      baseQuantity: 3,
      remainingQuantity: 0,
      createdAt: Date.now(),
      lastModified: '2025-01-01T00:00:00.000Z',
    };
    db.putShopItem('s1', staleData);

    // Verify remainingQuantity is still 3 (the reset value), not overwritten by stale data
    const updatedItems = db.getShopItems();
    expect(updatedItems.find((r: any) => r.id === 's1').remainingQuantity).toBe(3);
  });

  it('每日重置后正常购买应正确减少数量', () => {
    const items = [
      { id: 's1', name: '零食', baseQuantity: 3, remainingQuantity: 3, createdAt: Date.now() },
    ];
    db.saveShopItems(items);

    // 模拟已在今天重置过，防止 getShopItems 再次触发重置
    const today = new Date().toISOString().slice(0, 10);
    (db as any).db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)"
    ).run(today);

    // 正常购买：客户端基于最新数据减 1
    const currentData = {
      id: 's1',
      name: '零食',
      baseQuantity: 3,
      remainingQuantity: 2,
      createdAt: Date.now(),
      lastModified: new Date().toISOString(),
    };
    db.putShopItem('s1', currentData);

    const result = db.getShopItems();
    expect(result.find((r: any) => r.id === 's1').remainingQuantity).toBe(2);
  });
});
