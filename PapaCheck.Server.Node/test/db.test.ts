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

    it('dailySettlement 表中 null 数据不崩溃', () => {
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)"
      ).run('2026-06-06', 'null');

      const data = db.getFullData();
      expect(data.dailySettlement['2026-06-06']).toBeUndefined();
    });

    it('efficiencyHistory 表中非法 JSON 不崩溃', () => {
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO efficiency_history (date_key, data) VALUES (?, ?)"
      ).run('2026-06-06', '{broken');

      expect(() => db.getFullData()).not.toThrow();
    });

    it('freeTimeTasks 表中非数组数据不崩溃', () => {
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO free_time_tasks (date_key, data) VALUES (?, ?)"
      ).run('2026-06-06', JSON.stringify({ bad: 'object' }));

      const data = db.getFullData();
      // _filterDeleted 会返回非数组原样，但不应崩溃
      expect(data.freeTimeTasks['2026-06-06']).toEqual({ bad: 'object' });
    });

    it('bountyCompletions 表中 null 数据不崩溃', () => {
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO bounty_completions (date_key, data) VALUES (?, ?)"
      ).run('2026-06-06', 'null');

      const data = db.getFullData();
      expect(data.bountyCompletions['2026-06-06']).toBeUndefined();
    });
  });

  describe('putHomework 容错', () => {
    it('dateKey 数据损坏为 object 时能正常写入新作业', () => {
      // 模拟数据损坏：现有数据为对象而非数组
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)"
      ).run('2026-06-06', JSON.stringify({ id: 'orphan', subject: '损坏数据' }));

      // 写入新作业
      db.putHomework('new-hw-1', {
        id: 'new-hw-1',
        subject: '数学',
        content: '练习册',
        dateKey: '2026-06-06',
        status: 'pending',
      });

      // 验证已恢复为数组
      const hwList = db.getHomeworks('2026-06-06');
      expect(Array.isArray(hwList)).toBe(true);
      expect(hwList.length).toBe(1);
      expect(hwList[0].subject).toBe('数学');
    });
  });

  describe('_safeJsonParse 集成', () => {
    it('_getJson 在 shop_items 表非法 JSON 时不崩溃', () => {
      // 直接写入非法 JSON（INSERT 确保行存在）
      (db as any).db.prepare("INSERT OR REPLACE INTO shop_items (id, data) VALUES (1, ?)").run('{broken');
      // 不抛出即可
      expect(() => db.getShopItems()).not.toThrow();
      expect(db.getShopItems()).toEqual([]);
    });

    it('_getDateDataRaw 在 homeworks 表非法 JSON 时不崩溃', () => {
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO homeworks (date_key, data) VALUES (?, ?)"
      ).run('corrupt-date', '{broken');

      // 底层方法应该安全返回 undefined
      expect(() => { (db as any)._getDateDataRaw('homeworks', 'corrupt-date'); }).not.toThrow();
    });

    it('_safeJsonParse 在 JSON null 时返回 undefined', () => {
      const result = (db as any)._safeJsonParse('null');
      expect(result).toBeUndefined();
    });

    it('_safeJsonParse 在 undefined 输入时返回 undefined', () => {
      const result = (db as any)._safeJsonParse(undefined);
      expect(result).toBeUndefined();
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
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 1, name: '零食', baseQuantity: 2, remainingQuantity: 2 });
      expect(result[1]).toMatchObject({ id: 2, name: '玩具', baseQuantity: 1, remainingQuantity: 1 });
      expect(result[0].lastModified).toBeDefined();
      expect(result[1].lastModified).toBeDefined();
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

    // Feature: resetDate 清理 active_buffs
    //   Scenario: 重置日期时，应清除 startDate 匹配的 buff
    //     Given 存在多个 startDate 不同的 buff
    //     When 调用 resetDate
    //     Then 匹配的 buff 应被移除
    it('resetDate 应清理 startDate 匹配的 active_buffs', () => {
      db.saveActiveBuffs([
        { id: 'buff1', name: '专注', startDate: '2026-06-06', duration: 30, unit: 'min' },
        { id: 'buff2', name: '高效', startDate: '2026-06-07', duration: 30, unit: 'min' },
      ]);

      db.resetDate('2026-06-06');

      const buffs = db.getActiveBuffs();
      expect(buffs).toHaveLength(1);
      expect(buffs[0].id).toBe('buff2');
    });

    it('resetDate 无效 dateKey 格式不崩溃（不足三段）', () => {
      // dateKey 长度不足 3 段应提前 return
      expect(() => db.resetDate('invalid')).not.toThrow();
    });

    it('resetDate 无效 dateKey 格式（两段）不崩溃', () => {
      expect(() => db.resetDate('2026-06')).not.toThrow();
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

    // Feature: pushMerge 删除 date_key 表中的条目
    //   Scenario: 通过 pushMerge 的 delete 类型标记作业为已删除
    //     Given 已存在一条作业记录
    //     When 使用 pushMerge 传入 type 为 delete
    //     Then 该作业应被标记为已删除（getHomeworkById 返回 null）
    it('pushMerge with type delete 应标记作业为已删除', () => {
      const dateKey = '2026-06-06';
      db.saveHomeworks(dateKey, [{ id: 'hw1', subject: '数学', lastModified: '2026-06-05T10:00:00Z' }]);

      db.pushMerge([{
        type: 'delete',
        uuid: 'hw1',
        data: { id: 'hw1', subject: '数学', date: dateKey, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      const result = db.getHomeworkById('hw1');
      expect(result).toBeNull();
    });

    // Feature: pushMerge 向已有的 date_key 表新增条目
    //   Scenario: pushMerge 传入新 UUID 时，应推入新条目
    //     Given 已存在一条作业记录
    //     When 使用 pushMerge 传入不同 UUID 的新数据
    //     Then 应返回两条记录
    it('pushMerge with 新 UUID 应推入新条目', () => {
      const dateKey = '2026-06-06';
      db.saveHomeworks(dateKey, [{ id: 'hw1', subject: '数学', lastModified: '2026-06-05T10:00:00Z' }]);

      db.pushMerge([{
        type: 'update',
        uuid: 'hw2',
        data: { id: 'hw2', subject: '语文', date: dateKey, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      const homeworks = db.getHomeworks(dateKey);
      expect(homeworks).toHaveLength(2);
    });

    // Feature: pushMerge 处理 date_key 表中对象类型数据
    //   Scenario: 当 existing 是非数组的对象（dict）时，不应崩溃
    //     Given daily_settlement 表存在一条对象记录
    //     When 使用 pushMerge 合并新数据
    //     Then 不应崩溃，数据应被正确合并
    it('pushMerge 处理 dict 类型的 date_key 表', () => {
      const dateKey = '2026-06-06';
      // 直接写入非数组 JSON 到 daily_settlement 表
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO daily_settlement (date_key, data) VALUES (?, ?)"
      ).run(dateKey, JSON.stringify({ rating: 'A', dailyBase: 100 }));

      expect(() => {
        db.pushMerge([{
          type: 'update',
          uuid: 'settlement-1',
          data: { rating: 'A+', dailyBase: 110, date: dateKey, lastModified: '2026-06-06T10:00:00Z' },
          timestamp: '2026-06-06T10:00:00Z',
        }]);
      }).not.toThrow();

      const result = db.getSettlement(dateKey);
      expect(result.rating).toBe('A+');
    });

    // Feature: pushMerge 对 date_key 表且无 date 字段应跳过
    //   Scenario: 数据缺少 date/dateKey/uuid 时跳过处理
    //     Given 当前数据库状态
    //     When 使用 pushMerge 传入 data 无 date/dateKey 且 uuid 为空
    //     Then 不抛出异常，recordKey 为空跳过该条变更
    it('pushMerge 无 date 字段且空 uuid 的 bounty_submissions 应跳过', () => {
      expect(() => {
        db.pushMerge([{
          type: 'update',
          uuid: '',
          data: { id: 'bs1', taskId: 'bt1', startedAt: '2026-06-06T10:00:00Z' },
          timestamp: '2026-06-06T10:00:00Z',
        }]);
      }).not.toThrow();
    });

    // Feature: pushMerge 对 date_key 表 dict 类型执行 delete
    //   Scenario: delete 标记 daily_settlement 数据为已删除
    //     Given daily_settlement 存在一条记录
    //     When 使用 pushMerge 传入 type delete 且数据为 dict 类型
    //     Then 数据被标记 isDeleted
    it('pushMerge 对 daily_settlement dict 类型执行 delete', () => {
      const dateKey = '2026-06-06';
      db.saveSettlement(dateKey, { rating: 'A', dailyBase: 100 });

      db.pushMerge([{
        type: 'delete',
        uuid: 'settlement-del',
        data: { rating: 'A', dailyBase: 100, date: dateKey, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      // delete 操作在 dict 类型上标记 isDeleted
      const raw = (db as any)._getDateDataRaw('daily_settlement', dateKey);
      expect(raw.isDeleted).toBe(true);
    });
  });

  describe('pushMerge - single-row tables', () => {
    // Feature: pushMerge 向单行表（shop_items）添加条目
    //   Scenario: pushMerge 向 shop_items 添加新条目
    //     Given shop_items 表已有数据
    //     When 使用 pushMerge 添加新商品
    //     Then 应包含新旧两个商品
    it('pushMerge for shop_items 应添加新条目', () => {
      db.saveShopItems([{ id: 's1', name: '零食', lastModified: '2026-06-05T10:00:00Z' }]);

      db.pushMerge([{
        type: 'update',
        uuid: 's2',
        data: { id: 's2', name: '玩具', cost: 10, baseQuantity: 1, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      const items = db.getShopItems();
      expect(items).toHaveLength(2);
    });

    // Feature: pushMerge 删除单行表中的条目
    //   Scenario: pushMerge 传入 type 为 delete 时标记商品为已删除
    //     Given shop_items 表存在一个商品
    //     When 使用 pushMerge 传入 type 为 delete
    //     Then 该商品应被标记为已删除
    it('pushMerge for shop_items with type delete 应标记为已删除', () => {
      db.saveShopItems([{ id: 's1', name: '零食', lastModified: '2026-06-05T10:00:00Z' }]);

      db.pushMerge([{
        type: 'delete',
        uuid: 's1',
        data: { id: 's1', name: '零食', cost: 10, baseQuantity: 1, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      const result = db.getShopItemById('s1');
      expect(result).toBeNull();
    });

    // Feature: pushMerge 向 bounty_tasks 添加条目
    //   Scenario: pushMerge 向 bounty_tasks 添加新任务
    //     Given bounty_tasks 表已有数据
    //     When 使用 pushMerge 添加新任务
    //     Then 应包含两个任务
    it('pushMerge for bounty_tasks 应添加新条目', () => {
      db.saveBountyTasks([{ id: 'bt1', name: '赏金1', points: 50, lastModified: '2026-06-05T10:00:00Z' }]);

      db.pushMerge([{
        type: 'update',
        uuid: 'bt2',
        data: { id: 'bt2', name: '赏金2', points: 30, createdAt: '2026-06-06T10:00:00Z', lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      const tasks = db.getBountyTasks();
      expect(tasks).toHaveLength(2);
    });

    // Feature: pushMerge 在单行表中找不到条目时推入新条目
    //   Scenario: pushMerge 时 UUID 不存在于单行表中，应推入新条目
    //     Given shop_items 表存在两个商品
    //     When 使用 pushMerge 传入不存在的 UUID
    //     Then 应新增为第三条
    it('pushMerge for single-row table 找不到条目时推入新条目', () => {
      db.saveShopItems([
        { id: 's1', name: '零食', lastModified: '2026-06-05T10:00:00Z' },
        { id: 's2', name: '玩具', lastModified: '2026-06-05T10:00:00Z' },
      ]);

      db.pushMerge([{
        type: 'update',
        uuid: 's3',
        data: { id: 's3', name: '图书', cost: 20, baseQuantity: 1, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      const items = db.getShopItems();
      expect(items).toHaveLength(3);
    });

    // Feature: pushMerge 对 SINGLE_ROW dict 类型（settings）执行 delete
    //   Scenario: delete 标记 settings 数据为已删除
    //     Given settings 表存在一条记录
    //     When 使用 pushMerge 传入 type delete 且数据为 dict 类型
    //     Then 数据被标记 isDeleted
    it('pushMerge for settings dict type with delete 应标记 isDeleted', () => {
      db.saveSettings({ dailyBasePoints: 100, ratingMultipliers: { A: 1.0 } });

      db.pushMerge([{
        type: 'delete',
        uuid: 'settings-delete',
        data: { dailyBasePoints: 100, lastModified: '2026-06-06T10:00:00Z' },
        timestamp: '2026-06-06T10:00:00Z',
      }]);

      // settings 是 dict 类型，delete 应标记 isDeleted
      const settings = (db as any)._getJson('settings');
      expect(settings.isDeleted).toBe(true);
    });

    // Feature: pushMerge 非对象数据类型应跳过
    //   Scenario: 传入 data 为字符串或 null
    //     Given 任何数据库状态
    //     When 使用 pushMerge 传入非对象 data
    //     Then 跳过该条变更
    it('pushMerge 非对象数据类型（字符串）应跳过', () => {
      expect(() => {
        db.pushMerge([{
          type: 'update',
          uuid: 'string-data',
          data: 'this-is-not-an-object',
          timestamp: '2026-06-06T10:00:00Z',
        }]);
      }).not.toThrow();
    });

    it('pushMerge data 为 null 应跳过', () => {
      expect(() => {
        db.pushMerge([{
          type: 'update',
          uuid: 'null-data',
          data: null,
          timestamp: '2026-06-06T10:00:00Z',
        }]);
      }).not.toThrow();
    });

    // Feature: pushMerge 无法分类的数据应跳过
    //   Scenario: 传入 data 无法匹配任何表
    //     Given 任何数据库状态
    //     When 使用 pushMerge 传入无法分类的 data
    //     Then 跳过该条变更
    it('pushMerge 无法分类的数据（无匹配字段）应跳过', () => {
      expect(() => {
        db.pushMerge([{
          type: 'update',
          uuid: 'unclassified',
          data: { someUnknownField: 'value' },
          timestamp: '2026-06-06T10:00:00Z',
        }]);
      }).not.toThrow();
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

    it('putHomework 在软删除记录上创建新记录', () => {
      // 先删除作业
      db.deleteHomework('hw1');
      expect(db.getHomeworkById('hw1')).toBeNull();

      // 用同一 ID 重新创建——应创建新记录（不是恢复旧的）
      db.putHomework('hw1', { id: 'hw1', subject: '重新创建', content: '新内容', dateKey: '2026-06-07' });

      // getHomeworkById 按 _findRecordById 顺序找到旧记录（已删除），返回 null
      expect(db.getHomeworkById('hw1')).toBeNull();

      // 验证新记录在 dateKey=2026-06-07 的列表中
      const hwList = db.getHomeworks('2026-06-07');
      const newHw = hwList.find((h: any) => h.id === 'hw1');
      expect(newHw).toBeDefined();
      expect(newHw!.subject).toBe('重新创建');

      // 验证旧记录仍有 isDeleted 标记
      const raw = (db as any)._getDateDataRaw('homeworks', '2026-06-06');
      const oldDeleted = raw.find((h: any) => h.id === 'hw1' && h.isDeleted);
      expect(oldDeleted).toBeDefined();
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

  describe('每日数量重置', () => {
    it('当日期变更时，getShopItems 应重置 remainingQuantity 为 baseQuantity', () => {
      const items = [
        { id: 's1', name: '零食', baseQuantity: 3, remainingQuantity: 0 },
        { id: 's2', name: '玩具', baseQuantity: 5, remainingQuantity: 2 },
        { id: 's3', name: '图书', baseQuantity: 1, remainingQuantity: 1 },
      ];
      db.saveShopItems(items);

      // 将 last_shop_reset 设为昨天，模拟日期变更
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)"
      ).run(yesterday);

      const result = db.getShopItems();

      expect(result.find((r: any) => r.id === 's1').remainingQuantity).toBe(3);
      expect(result.find((r: any) => r.id === 's2').remainingQuantity).toBe(5);
      expect(result.find((r: any) => r.id === 's3').remainingQuantity).toBe(1);
    });

    it('同一天多次调用不重复重置', () => {
      const items = [
        { id: 's1', name: '零食', baseQuantity: 3, remainingQuantity: 0 },
      ];
      db.saveShopItems(items);

      // 第一次触发应重置
      const result1 = db.getShopItems();
      expect(result1.find((r: any) => r.id === 's1').remainingQuantity).toBe(3);

      // 手动扣减
      const s1 = result1.find((r: any) => r.id === 's1');
      s1.remainingQuantity = 0;
      db.putShopItem('s1', s1);

      // 第二次获取不应再次重置（同一天）
      const result2 = db.getShopItems();
      expect(result2.find((r: any) => r.id === 's1').remainingQuantity).toBe(0);
    });

    it('没有 baseQuantity 的商品不触发重置（向后兼容）', () => {
      const items = [
        { id: 's1', name: '旧商品', dailyLimit: 3, dailySold: 3 },
      ];
      db.saveShopItems(items);

      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      (db as any).db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_shop_reset', ?)"
      ).run(yesterday);

      const result = db.getShopItems();
      const item = result.find((r: any) => r.id === 's1');
      expect(item.dailySold).toBe(0);
      expect(item.dailyLimit).toBe(3);
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

  describe('applyCRDTOperation', () => {
    // Feature: applyCRDTOperation 处理 delete 操作
    //   Scenario: delete 操作应标记对应资源为已删除
    //     Given 存在一条作业记录
    //     When 使用 applyCRDTOperation 传入 type 为 delete
    //     Then 该作业应被标记为已删除
    it('applyCRDTOperation with type delete for homeworks 应标记为已删除', () => {
      db.saveHomeworks('2026-06-06', [{ id: 'hw1', subject: '数学' }]);

      (db as any).applyCRDTOperation({
        id: 'op-1',
        type: 'delete',
        table: 'homeworks',
        resourceId: 'hw1',
        field: null,
        value: null,
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getHomeworkById('hw1');
      expect(result).toBeNull();
    });

    // Feature: applyCRDTOperation 删除 shop_items
    //   Scenario: delete 操作标记商品为已删除
    //     Given shop_items 表存在一个商品
    //     When 使用 applyCRDTOperation 传入 type 为 delete
    //     Then 该商品应被标记为已删除
    it('applyCRDTOperation with type delete for shop_items 应标记为已删除', () => {
      db.saveShopItems([{ id: 's1', name: '零食' }]);

      (db as any).applyCRDTOperation({
        id: 'op-2',
        type: 'delete',
        table: 'shop_items',
        resourceId: 's1',
        field: null,
        value: null,
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getShopItemById('s1');
      expect(result).toBeNull();
    });

    // Feature: applyCRDTOperation 删除 bounty_tasks
    //   Scenario: delete 操作标记赏金任务为已删除
    //     Given bounty_tasks 表存在一个任务
    //     When 使用 applyCRDTOperation 传入 type 为 delete
    //     Then 该任务应被标记为已删除
    it('applyCRDTOperation with type delete for bounty_tasks 应标记为已删除', () => {
      db.saveBountyTasks([{ id: 'bt1', name: '赏金1', points: 50 }]);

      (db as any).applyCRDTOperation({
        id: 'op-3',
        type: 'delete',
        table: 'bounty_tasks',
        resourceId: 'bt1',
        field: null,
        value: null,
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getBountyTaskById('bt1');
      expect(result).toBeNull();
    });

    // Feature: applyCRDTOperation 删除 active_buffs
    //   Scenario: delete 操作标记增益为已删除
    //     Given active_buffs 表存在一个增益
    //     When 使用 applyCRDTOperation 传入 type 为 delete
    //     Then 该增益应被标记为已删除
    it('applyCRDTOperation with type delete for active_buffs 应标记为已删除', () => {
      db.saveActiveBuffs([{ id: 'buff1', name: '专注', duration: 30, unit: 'min' }]);

      (db as any).applyCRDTOperation({
        id: 'op-4',
        type: 'delete',
        table: 'active_buffs',
        resourceId: 'buff1',
        field: null,
        value: null,
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const fullData = db.getFullData();
      expect(fullData.activeBuffs.find((b: any) => b.id === 'buff1')).toBeUndefined();
    });

    // Feature: applyCRDTOperation 处理 update 操作
    //   Scenario: update 操作应更新或创建对应资源
    //     Given 存在一条作业记录
    //     When 使用 applyCRDTOperation 传入 type 为 update
    //     Then 该作业应被更新
    it('applyCRDTOperation with type update for homeworks 应更新或创建', () => {
      db.saveHomeworks('2026-06-06', [{ id: 'hw1', subject: '数学', lastModified: '2026-06-05T10:00:00Z' }]);

      (db as any).applyCRDTOperation({
        id: 'op-5',
        type: 'update',
        table: 'homeworks',
        resourceId: 'hw1',
        field: null,
        value: { id: 'hw1', subject: '数学_修改', content: 'P20', lastModified: '2026-06-06T10:00:00Z', dateKey: '2026-06-06' },
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getHomeworkById('hw1');
      expect(result).not.toBeNull();
      expect(result!.subject).toBe('数学_修改');
    });

    // Feature: applyCRDTOperation 更新 shop_items
    //   Scenario: update 操作更新商品信息
    //     Given shop_items 表存在一个商品
    //     When 使用 applyCRDTOperation 传入 type 为 update
    //     Then 该商品应被更新
    it('applyCRDTOperation with type update for shop_items 应更新', () => {
      db.saveShopItems([{ id: 's1', name: '零食' }]);

      (db as any).applyCRDTOperation({
        id: 'op-6',
        type: 'update',
        table: 'shop_items',
        resourceId: 's1',
        field: null,
        value: { id: 's1', name: '零食（大包）' },
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getShopItemById('s1');
      expect(result!.name).toBe('零食（大包）');
    });

    // Feature: applyCRDTOperation 更新 bounty_tasks
    //   Scenario: update 操作更新赏金任务
    //     Given bounty_tasks 表存在一个任务
    //     When 使用 applyCRDTOperation 传入 type 为 update
    //     Then 该任务应被更新
    it('applyCRDTOperation with type update for bounty_tasks 应更新', () => {
      db.saveBountyTasks([{ id: 'bt1', name: '赏金1', points: 50 }]);

      (db as any).applyCRDTOperation({
        id: 'op-7',
        type: 'update',
        table: 'bounty_tasks',
        resourceId: 'bt1',
        field: null,
        value: { id: 'bt1', name: '赏金1（修改）', points: 60 },
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getBountyTaskById('bt1');
      expect(result!.points).toBe(60);
    });

    // Feature: applyCRDTOperation 更新 settings
    //   Scenario: update 操作更新设置
    //     Given settings 表存在设置值
    //     When 使用 applyCRDTOperation 传入 type 为 update
    //     Then 设置应被更新
    it('applyCRDTOperation with type update for settings 应更新', () => {
      db.saveSettings({ dailyBasePoints: 100 });

      (db as any).applyCRDTOperation({
        id: 'op-8',
        type: 'update',
        table: 'settings',
        resourceId: '1',
        field: null,
        value: { dailyBasePoints: 150 },
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const result = db.getSettings();
      expect(result.dailyBasePoints).toBe(150);
    });
  });

  describe('通知专用接口', () => {
    let db: any;
    let dbPath: string;
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'papacheck-test-notify-'));
      dbPath = join(tmpDir, 'test.db');
      db = new (Database)(dbPath);
    });

    afterEach(() => {
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // Feature: 通知创建
    //   Scenario: 写入通知
    //     Given 数据库已初始化
    //     When 调用 addNotification('测试通知')
    //     Then 返回的 id 是有效的 UUID 字符串
    //     And 通知被正确写入数据库
    it('addNotification 写入通知并返回 id', () => {
      const id = (db as any).addNotification('测试通知');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    // Feature: 拉取通知
    //   Scenario: 返回有效期内通知
    //     Given 数据库中有两条通知（先后写入）
    //     When 调用 getPendingNotifications()
    //     Then 返回包含两条通知的数组
    //     And 按 created_at 升序排列
    it('getPendingNotifications 返回未过期通知', () => {
      (db as any).addNotification('通知一');
      (db as any).addNotification('通知二');

      const notifications = (db as any).getPendingNotifications();
      expect(notifications).toHaveLength(2);
      expect(notifications[0].createdAt).toBeLessThanOrEqual(notifications[1].createdAt);
    });

    // Feature: 过期过滤
    //   Scenario: 超过 1 分钟的通知不返回
    //     Given 数据库中有一条 2 分钟前的通知（通过修改 created_at 模拟）
    //     When 调用 getPendingNotifications()
    //     Then 返回空数组
    it('getPendingNotifications 过滤过期通知', () => {
      (db as any).db.prepare(
        'INSERT INTO notifications (id, text, created_at) VALUES (?, ?, ?)'
      ).run('old-id', '旧通知', Date.now() - 7200000);

      const notifications = (db as any).getPendingNotifications();
      expect(notifications).toEqual([]);
    });

    // Feature: 过期清理
    //   Scenario: getPendingNotifications 自动删除过期通知
    //     Given 数据库中有一条过期通知和一条有效通知
    //     When 调用 getPendingNotifications()
    //     Then 过期通知被删除，有效通知保留
    it('getPendingNotifications 自动删除过期通知', () => {
      (db as any).db.prepare(
        'INSERT INTO notifications (id, text, created_at) VALUES (?, ?, ?)'
      ).run('old-id', '旧通知', Date.now() - 7200000);
      const validId = (db as any).addNotification('新通知');

      const remaining = (db as any).getPendingNotifications();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(validId);
    });

    // Feature: 消费通知
    //   Scenario: 按 ids 删除
    //     Given 数据库中有多条通知
    //     When 调用 consumeNotifications([id1, id2])
    //     Then 指定的两条通知被删除，其余保留
    it('consumeNotifications 按 ids 批量删除', () => {
      const id1 = (db as any).addNotification('通知一');
      const id2 = (db as any).addNotification('通知二');
      const id3 = (db as any).addNotification('通知三');

      (db as any).consumeNotifications([id1, id2]);

      const remaining = (db as any).getPendingNotifications();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id3);
    });

    // Feature: 消费通知批处理
    //   Scenario: 超过 500 个 ID 时分批处理
    //     Given 数据库中有 510 条通知
    //     When 调用 consumeNotifications(ids) 传入 510 个 ID
    //     Then 所有通知被删除
    it('consumeNotifications 超过 500 个 ID 时批量处理', () => {
      const ids: string[] = [];
      const count = 510;
      for (let i = 0; i < count; i++) {
        const id = `batch-${String(i).padStart(4, '0')}`;
        ids.push(id);
        (db as any).db.prepare(
          'INSERT INTO notifications (id, text, created_at) VALUES (?, ?, ?)'
        ).run(id, `批量通知${i}`, Date.now());
      }

      (db as any).consumeNotifications(ids);

      const remaining = (db as any).getPendingNotifications();
      expect(remaining).toHaveLength(0);

      // 验证数据库中确实没有记录
      const allRows = (db as any).db.prepare('SELECT COUNT(*) as cnt FROM notifications').get() as any;
      expect(allRows.cnt).toBe(0);
    });

    // Feature: CRDT 分类
    //   Scenario: 识别 notifications
    //     Given 一个 data 对象包含 _table: 'notifications'
    //     When 调用 _classifyChange(data)
    //     Then 返回 'notifications'
    it('_classifyChange 识别 notifications 类型', () => {
      const result = (db as any)._classifyChange({ _table: 'notifications' });
      expect(result).toBe('notifications');
    });

    // Feature: CRDT 操作应用
    //   Scenario: notifications 的 update 操作
    //     Given 一个 CRDT update 操作，table 为 'notifications'
    //     When 调用 applyCRDTOperation(op)
    //     Then 通知被成功创建
    it('applyCRDTOperation 的 notifications 分支能创建通知', () => {
      (db as any).applyCRDTOperation({
        id: 'op-notify-1',
        type: 'update',
        table: 'notifications',
        resourceId: 'notify-1',
        field: null,
        value: { id: 'notify-1', text: 'CRDT通知' },
        timestamp: '2026-06-06T10:00:00Z',
        nodeId: 'node1',
      });

      const notifications = (db as any).getPendingNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].text).toBe('CRDT通知');
    });
  });
});
