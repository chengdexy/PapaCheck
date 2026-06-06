import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from '../src/db/index.js';

describe('Database', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    // 为每个测试用例创建临时数据库文件
    const tmpDir = mkdtempSync(join(tmpdir(), 'papacheck-test-'));
    dbPath = join(tmpDir, 'test.db');
    db = new Database(dbPath);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    // 清理临时目录
    const dir = dbPath.substring(0, dbPath.lastIndexOf('\\'));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('创建并打开一个新的数据库文件', () => {
      expect(existsSync(dbPath)).toBe(true);
      // 验证数据库已初始化，points 表有默认行
      const balance = db.getPointsBalance();
      expect(balance).toBe(0);
    });
  });

  describe('getFullData', () => {
    it('返回正确的结构，空表时值为默认', () => {
      const data = db.getFullData();
      expect(data).toHaveProperty('points');
      expect(data.points).toHaveProperty('balance', 0);
      expect(data.points).toHaveProperty('history', []);
      expect(data).toHaveProperty('badges', []);
      expect(data).toHaveProperty('history', {});
      expect(data).toHaveProperty('tasks', {});
      expect(data).toHaveProperty('homeworks', {});
      expect(data).toHaveProperty('dailySettlement', {});
      expect(data).toHaveProperty('shopItems', []);
      expect(data).toHaveProperty('redemptions', []);
      expect(data).toHaveProperty('rewardBox', []);
      expect(data).toHaveProperty('settings', {});
      expect(data).toHaveProperty('activeBuffs', []);
      expect(data).toHaveProperty('efficiencyHistory', {});
      expect(data).toHaveProperty('freeTimeTasks', {});
      expect(data).toHaveProperty('bountyTasks', []);
      expect(data).toHaveProperty('bountySubmissions', {});
      expect(data).toHaveProperty('bountyCompletions', {});
    });

    it('homeworks 表中非数组数据不崩溃', () => {
      // 模拟数据损坏：写入非数组数据
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)"
      ).run('2026-06-06', JSON.stringify({ bad: 'not an array' }));

      const data = db.getFullData();
      expect(data.homeworks['2026-06-06']).toBeUndefined();
    });
  });

  describe('homeworks CRUD', () => {
    const dateKey = '2026-06-06';
    const hwItems = [
      { id: 'hw1', subject: '数学', content: '练习册P10', isDeleted: false },
      { id: 'hw2', subject: '语文', content: '作文', isDeleted: false },
    ];

    it('保存并获取作业', () => {
      db.saveHomeworks(dateKey, hwItems);
      const result = db.getHomeworks(dateKey);
      expect(result).toEqual(hwItems);
    });

    it('获取不存在的日期返回空数组', () => {
      const result = db.getHomeworks('2099-01-01');
      expect(result).toEqual([]);
    });

    it('读取时过滤 isDeleted 项', () => {
      const itemsWithDeleted = [
        ...hwItems,
        { id: 'hw3', subject: '英语', content: '单词', isDeleted: true },
      ];
      db.saveHomeworks(dateKey, itemsWithDeleted);
      const result = db.getHomeworks(dateKey);
      expect(result).toHaveLength(2);
      expect(result.find((h: any) => h.id === 'hw3')).toBeUndefined();
    });

    it('移动作业到另一天', () => {
      db.saveHomeworks('2026-06-06', hwItems);
      const moved = db.moveHomework('2026-06-06', '2026-06-07', 'hw1');
      expect(moved).not.toBeNull();
      expect(moved!.id).toBe('hw1');

      const fromResult = db.getHomeworks('2026-06-06');
      expect(fromResult).toHaveLength(1);
      expect(fromResult[0].id).toBe('hw2');

      const toResult = db.getHomeworks('2026-06-07');
      expect(toResult).toHaveLength(1);
      expect(toResult[0].id).toBe('hw1');
    });

    it('移动不存在的 homework 返回 null', () => {
      db.saveHomeworks('2026-06-06', hwItems);
      const result = db.moveHomework('2026-06-06', '2026-06-07', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('shop items CRUD', () => {
    const shopItems = [
      { id: 1, name: '零食', baseQuantity: 2, remainingQuantity: 2 },
      { id: 2, name: '玩具', baseQuantity: 1, remainingQuantity: 1 },
    ];

    it('保存并获取商品', () => {
      db.saveShopItems(shopItems);
      const result = db.getShopItems();
      expect(result).toEqual(shopItems);
    });
  });

  describe('redemptions CRUD', () => {
    const items = [
      { itemId: 'r1', itemName: '兑换1', status: 'pending' },
    ];

    it('保存并获取兑换记录', () => {
      db.saveRedemptions(items);
      const result = db.getRedemptions();
      expect(result).toEqual(items);
    });
  });

  describe('reward box CRUD', () => {
    const items = [
      { name: '宝箱1', quantity: 1 },
    ];

    it('保存并获取奖励箱', () => {
      db.saveRewardBox(items);
      const result = db.getRewardBox();
      expect(result).toEqual(items);
    });
  });

  describe('settings CRUD', () => {
    const settings = { dailyBasePoints: 100, ratingMultipliers: { A: 1.0 } };

    it('保存并获取设置', () => {
      db.saveSettings(settings);
      const result = db.getSettings();
      expect(result).toEqual(settings);
    });
  });

  describe('active buffs CRUD', () => {
    const buffs = [
      { name: '专注', duration: 30, unit: 'min' },
    ];

    it('保存并获取活跃增益', () => {
      db.saveActiveBuffs(buffs);
      const result = db.getActiveBuffs();
      expect(result).toEqual(buffs);
    });
  });

  describe('efficiency CRUD', () => {
    const dateKey = '2026-06-06';
    const data = { efficiencyRatio: 0.85, averageRatio: 0.75 };

    it('保存并获取效率数据', () => {
      db.saveEfficiency(dateKey, data);
      const result = db.getEfficiency(dateKey);
      expect(result).toEqual(data);
    });

    it('获取不存在的日期返回 null', () => {
      const result = db.getEfficiency('2099-01-01');
      expect(result).toBeNull();
    });
  });

  describe('free time CRUD', () => {
    const dateKey = '2026-06-06';
    const tasks = [
      { name: '自由活动', durationMinutes: 30 },
    ];

    it('保存并获取空闲时间任务', () => {
      db.saveFreeTime(dateKey, tasks);
      const result = db.getFreeTime(dateKey);
      expect(result).toEqual(tasks);
    });

    it('获取不存在的日期返回空数组', () => {
      const result = db.getFreeTime('2099-01-01');
      expect(result).toEqual([]);
    });
  });

  describe('bounty tasks CRUD', () => {
    const items = [
      { id: 'bt1', name: '赏金任务1', points: 50 },
    ];

    it('保存并获取赏金任务', () => {
      db.saveBountyTasks(items);
      const result = db.getBountyTasks();
      expect(result).toEqual(items);
    });
  });

  describe('bounty submissions CRUD', () => {
    const dateKey = '2026-06-06';
    const items = [
      { id: 'bs1', taskId: 'bt1', startedAt: '2026-06-06T10:00:00Z' },
    ];

    it('保存并获取赏金提交', () => {
      db.saveBountySubmissions(dateKey, items);
      const result = db.getBountySubmissions(dateKey);
      expect(result).toEqual(items);
    });
  });

  describe('bounty completions CRUD', () => {
    const dateKey = '2026-06-06';
    const data = { taskId: 'bt1', completed: true };

    it('保存并获取赏金完成记录', () => {
      db.saveBountyCompletions(dateKey, data);
      const result = db.getBountyCompletions(dateKey);
      expect(result).toEqual(data);
    });
  });

  describe('points update', () => {
    it('earn 增加积分并记录历史', () => {
      const balance = db.updatePoints('earn', 100, '完成作业');
      expect(balance).toBe(100);

      const fullData = db.getFullData();
      expect(fullData.points.balance).toBe(100);
      expect(fullData.points.history).toHaveLength(1);
      expect(fullData.points.history[0].earned).toBe(100);
      expect(fullData.points.history[0].spent).toBe(0);
      expect(fullData.points.history[0].detail).toBe('完成作业');
    });

    it('spend 减少积分并记录历史', () => {
      db.updatePoints('earn', 200, '初始');
      const balance = db.updatePoints('spend', 50, '购买零食');
      expect(balance).toBe(150);

      const fullData = db.getFullData();
      expect(fullData.points.balance).toBe(150);
      // 历史应有两条记录
      expect(fullData.points.history).toHaveLength(2);
      expect(fullData.points.history[1].spent).toBe(50);
      expect(fullData.points.history[1].detail).toBe('购买零食');
    });
  });

  describe('modifiedSince / recordModification', () => {
    it('记录修改并查询最近修改', () => {
      const ts1 = '2026-06-06T10:00:00Z';
      db.recordModification('homeworks', '2026-06-06', ts1);

      const modified = db.getModifiedSince('2026-06-06T09:00:00Z');
      expect(modified).toHaveLength(1);
      expect(modified[0].table_name).toBe('homeworks');
      expect(modified[0].record_key).toBe('2026-06-06');
    });

    it('查询不早于某个时间点的修改', () => {
      const ts1 = '2026-06-06T10:00:00Z';
      db.recordModification('homeworks', '2026-06-06', ts1);

      const modified = db.getModifiedSince('2026-06-06T11:00:00Z');
      expect(modified).toHaveLength(0);
    });
  });

  describe('settlement', () => {
    const dateKey = '2026-06-06';
    const data = { rating: 'A', dailyBase: 100, actualPoints: 95 };

    it('保存并获取日结', () => {
      db.saveSettlement(dateKey, data);
      const result = db.getSettlement(dateKey);
      expect(result).toEqual(data);
    });
  });

  describe('resetDate', () => {
    it('删除指定日期的所有数据', () => {
      // 写入各种数据
      db.saveHomeworks('2026-06-06', [{ id: 'hw1', subject: '数学' }]);
      db.saveSettlement('2026-06-06', { rating: 'A' });
      db.saveEfficiency('2026-06-06', { efficiencyRatio: 0.8 });
      db.saveFreeTime('2026-06-06', [{ name: '玩' }]);
      db.saveBountySubmissions('2026-06-06', [{ id: 'bs1' }]);
      db.saveBountyCompletions('2026-06-06', { taskId: 'bt1' });

      // 另外一天的数据应保留
      db.saveHomeworks('2026-06-07', [{ id: 'hw2', subject: '语文' }]);

      db.resetDate('2026-06-06');

      expect(db.getHomeworks('2026-06-06')).toEqual([]);
      expect(db.getSettlement('2026-06-06')).toBeNull();
      expect(db.getEfficiency('2026-06-06')).toBeNull();
      expect(db.getFreeTime('2026-06-06')).toEqual([]);
      expect(db.getBountySubmissions('2026-06-06')).toEqual([]);
      expect(db.getBountyCompletions('2026-06-06')).toEqual({});

      // 另一天的数据应该还在
      expect(db.getHomeworks('2026-06-07')).toHaveLength(1);
    });
  });

  describe('importFullData / getFullData roundtrip', () => {
    it('导入完整数据后再导出应一致', () => {
      const input: any = {
        points: {
          balance: 500,
          history: [
            { id: 1, date: '2026-06-05', earned: 500, spent: 0, balance: 500, detail: '初始' },
          ],
        },
        badges: [{ id: 'b1', name: '勋章1' }],
        homeworks: { '2026-06-06': [{ id: 'hw1', subject: '数学' }] },
        dailySettlement: { '2026-06-06': { rating: 'A' } },
        shopItems: [{ id: 1, name: '零食' }],
        redemptions: [{ itemId: 'r1', itemName: '兑换1' }],
        rewardBox: [{ name: '宝箱1' }],
        settings: { dailyBasePoints: 100 },
        activeBuffs: [{ name: '专注' }],
        efficiencyHistory: { '2026-06-06': { efficiencyRatio: 0.8 } },
        freeTimeTasks: { '2026-06-06': [{ name: '玩' }] },
        bountyTasks: [{ id: 'bt1', name: '赏金' }],
        bountySubmissions: { '2026-06-06': [{ id: 'bs1' }] },
        bountyCompletions: { '2026-06-06': { taskId: 'bt1' } },
        history: {},
        tasks: {},
      };

      db.importFullData(input);
      const output = db.getFullData();

      expect(output.points.balance).toBe(500);
      expect(output.points.history).toHaveLength(1);
      expect(output.badges).toEqual(input.badges);
      expect(output.homeworks).toEqual(input.homeworks);
      expect(output.dailySettlement).toEqual(input.dailySettlement);
      expect(output.shopItems).toEqual(input.shopItems);
      expect(output.redemptions).toEqual(input.redemptions);
      expect(output.rewardBox).toEqual(input.rewardBox);
      expect(output.settings).toEqual(input.settings);
      expect(output.activeBuffs).toEqual(input.activeBuffs);
      expect(output.efficiencyHistory).toEqual(input.efficiencyHistory);
      expect(output.freeTimeTasks).toEqual(input.freeTimeTasks);
      expect(output.bountyTasks).toEqual(input.bountyTasks);
      expect(output.bountySubmissions).toEqual(input.bountySubmissions);
      expect(output.bountyCompletions).toEqual(input.bountyCompletions);
    });
  });

  describe('pushMerge', () => {
    it('合并简单的 points 变更', () => {
      const result = db.pushMerge([
        {
          type: 'update',
          uuid: 'points-1',
          data: { balance: 300, lastModified: '2026-06-06T10:00:00Z' },
          timestamp: '2026-06-06T10:00:00Z',
        },
      ]);
      expect(result).toEqual({ ok: true });
      expect(db.getPointsBalance()).toBe(300);
    });

    it('合并 date_key 表中的条目', () => {
      db.saveHomeworks('2026-06-06', [
        { id: 'hw1', subject: '数学', lastModified: '2026-06-05T10:00:00Z' },
      ]);

      const result = db.pushMerge([
        {
          type: 'update',
          uuid: 'hw1',
          data: {
            id: 'hw1',
            subject: '数学_修改',
            lastModified: '2026-06-06T10:00:00Z',
            date: '2026-06-06',
          },
          timestamp: '2026-06-06T10:00:00Z',
        },
      ]);
      expect(result).toEqual({ ok: true });

      const homeworks = db.getHomeworks('2026-06-06');
      expect(homeworks).toHaveLength(1);
      expect(homeworks[0].subject).toBe('数学_修改');
    });
  });

  describe('close', () => {
    it('重复关闭不会抛异常', () => {
      expect(() => {
        db.close();
        db.close();
      }).not.toThrow();
    });
  });

  // ==================== 新增资源级方法测试 ====================

  describe('_findInArray', () => {
    it('按 id 查找元素', () => {
      const items = [
        { id: 'a1', name: 'Item A' },
        { id: 'b2', name: 'Item B' },
      ];
      const result = (db as any)._findInArray(items, 'b2');
      expect(result).toEqual({ index: 1, item: items[1] });
    });

    it('按 uuid 查找元素', () => {
      const items = [
        { uuid: 'u1', name: 'Item 1' },
        { uuid: 'u2', name: 'Item 2' },
      ];
      const result = (db as any)._findInArray(items, 'u1');
      expect(result).toEqual({ index: 0, item: items[0] });
    });

    it('按 taskId 查找元素', () => {
      const items = [
        { taskId: 't1', name: 'Task 1' },
      ];
      const result = (db as any)._findInArray(items, 't1');
      expect(result).toEqual({ index: 0, item: items[0] });
    });

    it('找不到返回 index=-1 item=null', () => {
      const result = (db as any)._findInArray([], 'nonexistent');
      expect(result).toEqual({ index: -1, item: null });
    });

    it('在含有 null 的数组中查找不报错', () => {
      const items = [null, { id: 'x1', name: 'X' }];
      const result = (db as any)._findInArray(items, 'x1');
      expect(result).toEqual({ index: 1, item: items[1] });
    });
  });

  describe('_findRecordById', () => {
    const dateKey1 = '2026-06-06';
    const dateKey2 = '2026-06-07';

    beforeEach(() => {
      db.saveHomeworks(dateKey1, [
        { id: 'hw1', subject: '数学', content: 'P10' },
        { id: 'hw2', subject: '语文', content: '作文' },
      ]);
      db.saveHomeworks(dateKey2, [
        { id: 'hw3', subject: '英语', content: '单词' },
      ]);
    });

    it('在 date_key 表中按 id 查找记录', () => {
      const result = (db as any)._findRecordById('homeworks', 'hw2');
      expect(result).not.toBeNull();
      expect(result!.dateKey).toBe(dateKey1);
      expect(result!.item.subject).toBe('语文');
    });

    it('找不到返回 null', () => {
      const result = (db as any)._findRecordById('homeworks', 'nonexistent');
      expect(result).toBeNull();
    });

    it('空表返回 null', () => {
      const result = (db as any)._findRecordById('free_time_tasks', 'any');
      expect(result).toBeNull();
    });
  });

  describe('homeworks 单资源方法', () => {
    const dateKey = '2026-06-06';
    const hwData = { id: 'hw1', subject: '数学', content: '练习册P10' };

    beforeEach(() => {
      db.saveHomeworks(dateKey, [hwData]);
    });

    it('getHomeworkById 返回匹配的作业', () => {
      const result = db.getHomeworkById('hw1');
      expect(result).not.toBeNull();
      expect(result!.subject).toBe('数学');
    });

    it('getHomeworkById 找不到返回 null', () => {
      const result = db.getHomeworkById('nonexistent');
      expect(result).toBeNull();
    });

    it('putHomework 创建新作业', () => {
      db.putHomework('hw_new', { id: 'hw_new', subject: '物理', content: '实验' });
      const result = db.getHomeworkById('hw_new');
      expect(result).not.toBeNull();
      expect(result!.subject).toBe('物理');
    });

    it('putHomework 更新已有作业', () => {
      db.putHomework('hw1', { id: 'hw1', subject: '数学（修改）', content: 'P20' });
      const result = db.getHomeworkById('hw1');
      expect(result!.subject).toBe('数学（修改）');
      expect(result!.content).toBe('P20');
    });

    it('patchHomework 部分更新', () => {
      db.patchHomework('hw1', { content: 'P30' });
      const result = db.getHomeworkById('hw1');
      expect(result!.subject).toBe('数学');
      expect(result!.content).toBe('P30');
      expect(result!.lastModified).toBeDefined();
    });

    it('deleteHomework 标记删除', () => {
      db.deleteHomework('hw1');
      const result = db.getHomeworkById('hw1');
      expect(result).toBeNull();
      // 原始数据应标记 isDeleted
      const raw = (db as any)._getDateDataRaw('homeworks', dateKey);
      const deleted = raw.find((h: any) => h.id === 'hw1');
      expect(deleted.isDeleted).toBe(true);
    });
  });

  describe('daily_settlement 单资源方法', () => {
    const dateKey = '2026-06-06';
    const data = { rating: 'A', dailyBase: 100, actualPoints: 95 };

    it('putSettlement 创建/更新日结', () => {
      db.putSettlement(dateKey, data);
      const result = db.getSettlement(dateKey);
      expect(result).toEqual(data);
    });

    it('putSettlement 更新已有日结', () => {
      db.putSettlement(dateKey, { rating: 'B', dailyBase: 80 });
      db.putSettlement(dateKey, { rating: 'A', dailyBase: 100, actualPoints: 95 });
      const result = db.getSettlement(dateKey);
      expect(result.rating).toBe('A');
    });

    it('patchSettlement 部分更新', () => {
      db.putSettlement(dateKey, { rating: 'A', dailyBase: 100 });
      db.patchSettlement(dateKey, { actualPoints: 95 });
      const result = db.getSettlement(dateKey);
      expect(result.rating).toBe('A');
      expect(result.dailyBase).toBe(100);
      expect(result.actualPoints).toBe(95);
      expect(result.lastModified).toBeDefined();
    });
  });

  describe('patchPoints', () => {
    it('earn 增加积分', () => {
      const balance = db.patchPoints({ earn: 100, detail: '完成作业' });
      expect(balance).toBe(100);
      expect(db.getPointsBalance()).toBe(100);
    });

    it('spend 减少积分', () => {
      db.updatePoints('earn', 200, '初始');
      const balance = db.patchPoints({ spend: 50, detail: '购买零食' });
      expect(balance).toBe(150);
    });

    it('同时 earn 和 spend', () => {
      db.updatePoints('earn', 100, '初始');
      const balance = db.patchPoints({ earn: 50, spend: 30, detail: '净赚20' });
      expect(balance).toBe(120);
    });

    it('记录到 points_history', () => {
      db.patchPoints({ earn: 100, detail: '测试' });
      const fullData = db.getFullData();
      const lastHistory = fullData.points.history[fullData.points.history.length - 1];
      expect(lastHistory.earned).toBe(100);
      expect(lastHistory.spent).toBe(0);
      expect(lastHistory.detail).toBe('测试');
    });

    it('空 delta 不改变积分', () => {
      db.updatePoints('earn', 100, '初始');
      const balance = db.patchPoints({});
      expect(balance).toBe(100);
    });
  });

  describe('shop_items 单资源方法', () => {
    const items = [
      { id: 's1', name: '零食', baseQuantity: 2, remainingQuantity: 2 },
      { id: 's2', name: '玩具', baseQuantity: 1, remainingQuantity: 1 },
    ];

    beforeEach(() => {
      db.saveShopItems(items);
    });

    it('getShopItemById 返回匹配商品', () => {
      const result = db.getShopItemById('s1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('零食');
    });

    it('getShopItemById 找不到返回 null', () => {
      const result = db.getShopItemById('nonexistent');
      expect(result).toBeNull();
    });

    it('putShopItem 更新已有商品', () => {
      db.putShopItem('s1', { id: 's1', name: '零食（大包）', baseQuantity: 3, remainingQuantity: 3 });
      const result = db.getShopItemById('s1');
      expect(result!.name).toBe('零食（大包）');
    });

    it('putShopItem 创建新商品', () => {
      db.putShopItem('s3', { id: 's3', name: '图书', baseQuantity: 5, remainingQuantity: 5 });
      const all = db.getShopItems();
      expect(all).toHaveLength(3);
    });

    it('deleteShopItem 标记删除', () => {
      db.deleteShopItem('s1');
      const result = db.getShopItemById('s1');
      expect(result).toBeNull();
      // getFullData 应过滤已删除项
      const fullData = db.getFullData();
      expect(fullData.shopItems.find((s: any) => s.id === 's1')).toBeUndefined();
    });
  });

  describe('redemptions 单资源方法', () => {
    it('putRedemption 创建新兑换记录', () => {
      db.putRedemption('r1', { id: 'r1', itemId: 'r1', itemName: '兑换1', status: 'pending' });
      const redemptions = db.getRedemptions();
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0].itemName).toBe('兑换1');
    });

    it('putRedemption 更新已有兑换记录', () => {
      db.putRedemption('r1', { id: 'r1', itemId: 'r1', itemName: '兑换1', status: 'pending' });
      db.putRedemption('r1', { id: 'r1', itemId: 'r1', itemName: '兑换1', status: 'completed' });
      const redemptions = db.getRedemptions();
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0].status).toBe('completed');
    });
  });

  describe('reward_box 单资源方法', () => {
    it('putRewardBoxItem 创建新奖励箱物品', () => {
      db.putRewardBoxItem('rb1', { id: 'rb1', name: '宝箱1', quantity: 1 });
      const box = db.getRewardBox();
      expect(box).toHaveLength(1);
      expect(box[0].name).toBe('宝箱1');
    });

    it('putRewardBoxItem 更新已有物品', () => {
      db.putRewardBoxItem('rb1', { id: 'rb1', name: '宝箱1', quantity: 1 });
      db.putRewardBoxItem('rb1', { id: 'rb1', name: '宝箱1', quantity: 2 });
      const box = db.getRewardBox();
      expect(box).toHaveLength(1);
      expect(box[0].quantity).toBe(2);
    });
  });

  describe('settings 单资源方法', () => {
    it('putSettings 全量替换设置', () => {
      db.putSettings({ dailyBasePoints: 100, ratingMultipliers: { A: 1.0 } });
      const result = db.getSettings();
      expect(result.dailyBasePoints).toBe(100);
    });

    it('patchSettings 部分更新', () => {
      db.putSettings({ dailyBasePoints: 100, ratingMultipliers: { A: 1.0 } });
      db.patchSettings({ dailyBasePoints: 150 });
      const result = db.getSettings();
      expect(result.dailyBasePoints).toBe(150);
      expect(result.ratingMultipliers).toEqual({ A: 1.0 });
      expect(result.lastModified).toBeDefined();
    });
  });

  describe('active_buffs 单资源方法', () => {
    it('putBuff 创建新增益', () => {
      db.putBuff('buff1', { id: 'buff1', name: '专注', duration: 30, unit: 'min' });
      const buffs = db.getActiveBuffs();
      expect(buffs).toHaveLength(1);
      expect(buffs[0].name).toBe('专注');
    });

    it('putBuff 更新已有增益', () => {
      db.putBuff('buff1', { id: 'buff1', name: '专注', duration: 30, unit: 'min' });
      db.putBuff('buff1', { id: 'buff1', name: '专注', duration: 45, unit: 'min' });
      const buffs = db.getActiveBuffs();
      expect(buffs).toHaveLength(1);
      expect(buffs[0].duration).toBe(45);
    });

    it('deleteBuff 标记删除', () => {
      db.putBuff('buff1', { id: 'buff1', name: '专注', duration: 30, unit: 'min' });
      db.deleteBuff('buff1');
      // getFullData 会过滤已删除项
      const fullData = db.getFullData();
      expect(fullData.activeBuffs.find((b: any) => b.name === '专注')).toBeUndefined();
    });
  });

  describe('efficiency_history 单资源方法', () => {
    const dateKey = '2026-06-06';

    it('putEfficiency 保存效率数据', () => {
      db.putEfficiency(dateKey, { efficiencyRatio: 0.85, averageRatio: 0.75 });
      const result = db.getEfficiency(dateKey);
      expect(result.efficiencyRatio).toBe(0.85);
    });

    it('putEfficiency 更新已有数据', () => {
      db.putEfficiency(dateKey, { efficiencyRatio: 0.85 });
      db.putEfficiency(dateKey, { efficiencyRatio: 0.90, averageRatio: 0.80 });
      const result = db.getEfficiency(dateKey);
      expect(result.efficiencyRatio).toBe(0.90);
      expect(result.averageRatio).toBe(0.80);
    });
  });

  describe('free_time_tasks 单资源方法', () => {
    const dateKey = '2026-06-06';

    it('putFreeTimeTask 创建新任务', () => {
      db.putFreeTimeTask('ft1', { id: 'ft1', name: '自由活动', durationMinutes: 30, dateKey });
      const tasks = db.getFreeTime(dateKey);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe('自由活动');
    });

    it('putFreeTimeTask 更新已有任务', () => {
      db.putFreeTimeTask('ft1', { id: 'ft1', name: '自由活动', durationMinutes: 30, dateKey });
      db.putFreeTimeTask('ft1', { id: 'ft1', name: '自由活动（延长）', durationMinutes: 45, dateKey });
      const tasks = db.getFreeTime(dateKey);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].durationMinutes).toBe(45);
    });
  });

  describe('bounty_tasks 单资源方法', () => {
    it('getBountyTaskById 返回匹配任务', () => {
      db.saveBountyTasks([{ id: 'bt1', name: '赏金1', points: 50 }]);
      const result = db.getBountyTaskById('bt1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('赏金1');
    });

    it('getBountyTaskById 找不到返回 null', () => {
      const result = db.getBountyTaskById('nonexistent');
      expect(result).toBeNull();
    });

    it('putBountyTask 创建新任务', () => {
      db.putBountyTask('bt1', { id: 'bt1', name: '赏金1', points: 50 });
      const tasks = db.getBountyTasks();
      expect(tasks).toHaveLength(1);
    });

    it('putBountyTask 更新已有任务', () => {
      db.putBountyTask('bt1', { id: 'bt1', name: '赏金1', points: 50 });
      db.putBountyTask('bt1', { id: 'bt1', name: '赏金1（修改）', points: 60 });
      const result = db.getBountyTaskById('bt1');
      expect(result!.points).toBe(60);
    });

    it('deleteBountyTask 标记删除', () => {
      db.putBountyTask('bt1', { id: 'bt1', name: '赏金1', points: 50 });
      db.deleteBountyTask('bt1');
      const result = db.getBountyTaskById('bt1');
      expect(result).toBeNull();
    });
  });

  describe('bounty_submissions 单资源方法', () => {
    const dateKey = '2026-06-06';

    it('putBountySubmission 创建新提交', () => {
      db.putBountySubmission('bs1', { id: 'bs1', taskId: 'bt1', startedAt: '2026-06-06T10:00:00Z', dateKey });
      const subs = db.getBountySubmissions(dateKey);
      expect(subs).toHaveLength(1);
      expect(subs[0].taskId).toBe('bt1');
    });

    it('putBountySubmission 更新已有提交', () => {
      db.putBountySubmission('bs1', { id: 'bs1', taskId: 'bt1', startedAt: '2026-06-06T10:00:00Z', dateKey });
      db.putBountySubmission('bs1', { id: 'bs1', taskId: 'bt1', startedAt: '2026-06-06T11:00:00Z', dateKey });
      const subs = db.getBountySubmissions(dateKey);
      expect(subs).toHaveLength(1);
      expect(subs[0].startedAt).toBe('2026-06-06T11:00:00Z');
    });
  });

  describe('bounty_completions 单资源方法', () => {
    const dateKey = '2026-06-06';

    it('putBountyCompletion 创建完成记录', () => {
      db.putBountyCompletion(dateKey, { taskId: 'bt1', completed: true });
      const result = db.getBountyCompletions(dateKey);
      expect(result.taskId).toBe('bt1');
      expect(result.completed).toBe(true);
    });

    it('putBountyCompletion 更新已有记录', () => {
      db.putBountyCompletion(dateKey, { taskId: 'bt1', completed: false });
      db.putBountyCompletion(dateKey, { taskId: 'bt1', completed: true });
      const result = db.getBountyCompletions(dateKey);
      expect(result.completed).toBe(true);
    });
  });
});
