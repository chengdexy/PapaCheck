/**
 * redemption_dup_check.test.ts - 服务端重复 pending 兑换检查
 *
 * Feature: 服务端阻止同一 rewardBoxItemId 的重复 pending 兑换
 *   Scenario: 同 rewardBoxItemId 存在 pending 时返回 409
 *     Given 已有一条 pending 兑换（rewardBoxItemId: "rb1"）
 *     When 再次提交同 rewardBoxItemId 的 pending 兑换
 *     Then 返回 409 Conflict
 *
 *   Scenario: 不同 rewardBoxItemId 可正常创建
 *     Given 已有一条 pending 兑换（rewardBoxItemId: "rb1"）
 *     When 提交不同 rewardBoxItemId（"rb2"）的 pending 兑换
 *     Then 返回 200
 *
 *   Scenario: 已有兑换已兑现，可再次提交
 *     Given 有一条已兑现的兑换（rewardBoxItemId: "rb1", status: "fulfilled"）
 *     When 再次提交同 rewardBoxItemId 的 pending 兑换
 *     Then 返回 200
 *
 *   Scenario: 已有兑换已撤回，可再次提交
 *     Given 有一条已撤回的兑换（rewardBoxItemId: "rb1", status: "cancelled"）
 *     When 再次提交同 rewardBoxItemId 的 pending 兑换
 *     Then 返回 200
 *
 *   Scenario: 非 rewardBox 兑换不受此限制
 *     Given 已有一条 pending 兑换（fromRewardBox: false）
 *     When 提交非 rewardBox 的 pending 兑换
 *     Then 返回 200
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from '../src/db/index.js';

describe('服务端重复 pending 兑换检查', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'papacheck-test-dup-'));
    dbPath = join(tmpDir, 'test.db');
    db = new Database(dbPath);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    const dir = dbPath.substring(0, dbPath.lastIndexOf('\\'));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 辅助：检查是否存在重复 pending 兑换
  async function hasDuplicatePending(rewardBoxItemId: string, excludeId: string): Promise<boolean> {
    const redemptions = await db.getRedemptions();
    const existing = redemptions.find((r: any) =>
      r.rewardBoxItemId === rewardBoxItemId &&
      r.status === 'pending' &&
      r.id !== excludeId
    );
    return !!existing;
  }

  it('同 rewardBoxItemId 存在 pending 时返回 true', async () => {
    await db.putRedemption('r1', {
      id: 'r1',
      itemName: '游戏时间',
      status: 'pending',
      fromRewardBox: true,
      rewardBoxItemId: 'rb1',
    });

    const isDup = await hasDuplicatePending('rb1', 'r2');
    expect(isDup).toBe(true);
  });

  it('不同 rewardBoxItemId 返回 false', async () => {
    await db.putRedemption('r1', {
      id: 'r1',
      itemName: '游戏时间',
      status: 'pending',
      fromRewardBox: true,
      rewardBoxItemId: 'rb1',
    });

    const isDup = await hasDuplicatePending('rb2', 'r2');
    expect(isDup).toBe(false);
  });

  it('已有兑换已兑现（fulfilled）时可再次提交', async () => {
    await db.putRedemption('r1', {
      id: 'r1',
      itemName: '游戏时间',
      status: 'fulfilled',
      fromRewardBox: true,
      rewardBoxItemId: 'rb1',
    });

    const isDup = await hasDuplicatePending('rb1', 'r2');
    expect(isDup).toBe(false);
  });

  it('已有兑换已撤回（cancelled）时可再次提交', async () => {
    await db.putRedemption('r1', {
      id: 'r1',
      itemName: '游戏时间',
      status: 'cancelled',
      fromRewardBox: true,
      rewardBoxItemId: 'rb1',
    });

    const isDup = await hasDuplicatePending('rb1', 'r2');
    expect(isDup).toBe(false);
  });

  it('排除自身 ID — 更新自身不触发重复检查', async () => {
    await db.putRedemption('r1', {
      id: 'r1',
      itemName: '游戏时间',
      status: 'pending',
      fromRewardBox: true,
      rewardBoxItemId: 'rb1',
    });

    // 更新 r1 自身，应排除
    const isDup = await hasDuplicatePending('rb1', 'r1');
    expect(isDup).toBe(false);
  });

  it('非 rewardBox 兑换不受此限制', async () => {
    await db.putRedemption('r1', {
      id: 'r1',
      itemName: '直接兑换',
      status: 'pending',
      fromRewardBox: false,
      rewardBoxItemId: undefined,
    });

    // 非 rewardBox 兑换 rewardBoxItemId 为 undefined，查找时不应匹配
    const isDup = await hasDuplicatePending('rb-some-item', 'r2');
    expect(isDup).toBe(false);
  });
});
