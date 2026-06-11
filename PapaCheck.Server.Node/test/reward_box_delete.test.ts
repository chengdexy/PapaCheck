import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from '../src/db/index.js';

describe('reward_box 删除保护', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'papacheck-test-reward-delete-'));
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

  it('删除奖励箱物品后 getRewardBox 过滤掉已删除物品', () => {
    db.putRewardBoxItem('rb1', { id: 'rb1', name: '游戏时间30分钟', quantity: 1 });
    expect(db.getRewardBox()).toHaveLength(1);

    db.deleteRewardBoxItem('rb1');
    const result = db.getRewardBox();
    expect(result).toHaveLength(0);
  });

  it('删除后再 PUT 同一 ID 的物品应恢复', () => {
    db.putRewardBoxItem('rb1', { id: 'rb1', name: '游戏时间30分钟', quantity: 1 });
    db.deleteRewardBoxItem('rb1');
    expect(db.getRewardBox()).toHaveLength(0);

    // PUT 恢复（例如管理员重新添加）
    db.putRewardBoxItem('rb1', { id: 'rb1', name: '游戏时间30分钟（新）', quantity: 1 });
    const result = db.getRewardBox();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('游戏时间30分钟（新）');
  });
});
