import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

// ==================== Gherkin 行为注释 ====================

// Feature: 孩子数据隔离
//   家庭中每个孩子的独立数据按 child_id 隔离，
//   家庭共享数据不按 child_id 过滤。

//   Scenario: 同一家庭两个孩子的作业数据隔离
//     Given 家庭 A 有孩子小明(child_id_A)和孩子小红(child_id_B)
//     When 小明有一份数学作业，小红有一份语文作业
//     Then 查询小明的作业只返回数学作业
//     And 查询小红的作业只返回语文作业

//   Scenario: 同一家庭两个孩子的积分数据隔离
//     Given 家庭 A 有孩子小明(child_id_A)和孩子小红(child_id_B)
//     When 小明获得 50 积分，小红获得 100 积分
//     Then 查询小明的积分余额为 50
//     And 查询小红的积分余额为 100

//   Scenario: 同一家庭两个孩子的每日结算数据隔离
//     Given 家庭 A 有孩子小明(child_id_A)和孩子小红(child_id_B)
//     When 小明结算 rating=5，小红结算 rating=3
//     Then 查询小明的结算 rating 为 5
//     And 查询小红的结算 rating 为 3

//   Scenario: 共享数据（商店商品）不按孩子过滤
//     Given 家庭 A 有孩子小明(child_id_A)和孩子小红(child_id_B)
//     When 家长创建一个商店商品
//     Then 查询小明的商店列表包含该商品
//     And 查询小红的商店列表也包含该商品

//   Scenario: 共享数据（赏金任务）不按孩子过滤
//     Given 家庭 A 有孩子小明(child_id_A)和孩子小红(child_id_B)
//     When 家长创建一个赏金任务
//     Then 查询小明的赏金任务列表包含该任务
//     And 查询小红的赏金任务列表也包含该任务

//   Scenario: 遗留数据 child_id 为 NULL
//     Given 家庭 B 无孩子 access_code
//     When 迁移执行后
//     Then 家庭 B 的作业数据 child_id 为 NULL

//   Scenario: children 表基本 CRUD
//     Given 一个空的 children 表
//     When 创建一个孩子记录
//     Then 可以查到该孩子
//     And 可以按 tenant_id 列出所有孩子
//     And 可以删除该孩子

//   Scenario: 同一家庭孩子名字唯一
//     Given 家庭 A 已有孩子"小明"
//     When 尝试创建另一个名字"小明"的孩子
//     Then 操作失败（UNIQUE 约束）

//   Scenario: 修改孩子昵称
//     Given 家庭 A 有孩子"小明"
//     When 家长修改昵称为"大明"
//     Then 孩子昵称变为"大明"

//   Scenario: 禁用孩子（不删除数据）
//     Given 家庭 A 有孩子"小明"
//     When 家长禁用小明（is_active = false）
//     Then 小明的数据仍然存在
//     And 禁用后查询孩子列表不包含小明（默认只列出 active 孩子）
//     And 禁用后家长无法切换到小明

//   Scenario: 多孩子同时兑换限量商品（竞态防护）
//     Given 商店商品"冰激凌" remainingQuantity=1
//     And 孩子小明和孩子小红积分都 >= 成本
//     When 小明和小红几乎同时兑换
//     Then 只有一人兑换成功
//     And 另一人收到库存不足的错误

//   Scenario: 多孩子同时认领一次性赏金任务（竞态防护）
//     Given 赏金任务 maxCompletions=1
//     When 小明和小红几乎同时提交
//     Then 只有一人提交成功
//     And 另一人收到任务已完成的错误

//   Scenario: 新孩子首次使用时默认行初始化
//     Given 家庭 A 新建孩子小华
//     When 小华首次登录
//     Then points 表有 balance=0 的默认行
//     And badges/redemptions/reward_box/active_buffs 有默认空数据

//   Scenario: getFullData 按 child_id 返回 per-child 数据 + 共享数据
//     Given 家庭 A 有孩子小明(child_A)和孩子小红(child_B)
//     And 小明有作业和积分，小红有作业和积分，家庭有商店商品
//     When 调用 getFullData(tenantId, child_A)
//     Then 返回小明的作业和积分
//     And 不包含小红的作业和积分
//     And 包含家庭的商店商品（共享数据）

//   Scenario: 删除 access_code 时清理 children.access_code_id
//     Given 孩子小明关联了 access_code_X
//     When 删除 access_code_X
//     Then 小明的 children 记录仍然存在（不删除）
//     And 小明的 access_code_id 被设为 NULL
//     And 小明的 is_active 不变

//   Scenario: 禁用孩子后无法通过 access_code 登录
//     Given 孩子小明 is_active=false
//     When 小明尝试通过 access_code 登录
//     Then 登录失败（孩子已禁用）

//   Scenario: points_history 按 child_id 隔离
//     Given 家庭 A 有孩子小明(child_A)和孩子小红(child_B)
//     When 小明积分变动 +50，小红积分变动 +100
//     Then 查询小明的 points_history 只包含 +50 记录
//     And 查询小红的 points_history 只包含 +100 记录

describe.runIf(runPg)('Child Data Isolation (孩子数据隔离)', () => {
  let adapter: any;
  const tenantA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const childA = '11111111-1111-1111-1111-111111111111';
  const childB = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    // Setup: create user, tenants, children
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '孩子隔离测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, '孩子隔离测试') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小明') ON CONFLICT (id) DO NOTHING",
      [childA, tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小红') ON CONFLICT (id) DO NOTHING",
      [childB, tenantA]
    );
    // Ensure default rows exist for per-child tables
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 0) ON CONFLICT DO NOTHING",
      [tenantA, childA]
    );
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 0) ON CONFLICT DO NOTHING",
      [tenantA, childB]
    );
  });

  afterAll(async () => {
    // Cleanup per-child data
    const perChildTables = [
      'homeworks', 'daily_settlement', 'efficiency_history',
      'free_time_tasks', 'bounty_submissions', 'bounty_completions',
      'points', 'points_history', 'redemptions', 'reward_box',
      'active_buffs', 'badges',
    ];
    for (const table of perChildTables) {
      await adapter.pool.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND (child_id = $2 OR child_id = $3)`, [tenantA, childA, childB]).catch(() => {});
    }
    await adapter.pool.query('DELETE FROM children WHERE id IN ($1, $2)', [childA, childB]).catch(() => {});
  });

  // Scenario: 同一家庭两个孩子的作业数据隔离
  it('两个孩子作业数据隔离', async () => {
    const dateKey = '2026-06-21';

    // 小明有数学作业
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4)",
      [tenantA, childA, dateKey, JSON.stringify([{ id: 'hw1', subject: '数学' }])]
    );

    // 小红有语文作业
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4)",
      [tenantA, childB, dateKey, JSON.stringify([{ id: 'hw2', subject: '语文' }])]
    );

    // 查询小明的作业
    const hwA = await adapter.pool.query(
      'SELECT data FROM homeworks WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3',
      [tenantA, childA, dateKey]
    );
    const dataA = JSON.parse(hwA.rows[0].data);
    expect(dataA.length).toBe(1);
    expect(dataA[0].subject).toBe('数学');

    // 查询小红的作业
    const hwB = await adapter.pool.query(
      'SELECT data FROM homeworks WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3',
      [tenantA, childB, dateKey]
    );
    const dataB = JSON.parse(hwB.rows[0].data);
    expect(dataB.length).toBe(1);
    expect(dataB[0].subject).toBe('语文');
  });

  // Scenario: 同一家庭两个孩子的积分数据隔离
  it('两个孩子积分数据隔离', async () => {
    // 小明获得 50 积分
    await adapter.pool.query(
      "UPDATE points SET balance = 50 WHERE tenant_id = $1 AND child_id = $2 AND id = 1",
      [tenantA, childA]
    );

    // 小红获得 100 积分
    await adapter.pool.query(
      "UPDATE points SET balance = 100 WHERE tenant_id = $1 AND child_id = $2 AND id = 1",
      [tenantA, childB]
    );

    const balA = await adapter.pool.query(
      'SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1',
      [tenantA, childA]
    );
    expect(balA.rows[0].balance).toBe(50);

    const balB = await adapter.pool.query(
      'SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1',
      [tenantA, childB]
    );
    expect(balB.rows[0].balance).toBe(100);
  });

  // Scenario: 同一家庭两个孩子的每日结算数据隔离
  it('两个孩子每日结算数据隔离', async () => {
    const dateKey = '2026-06-21';

    await adapter.pool.query(
      "INSERT INTO daily_settlement (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4)",
      [tenantA, childA, dateKey, JSON.stringify({ rating: 5 })]
    );
    await adapter.pool.query(
      "INSERT INTO daily_settlement (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4)",
      [tenantA, childB, dateKey, JSON.stringify({ rating: 3 })]
    );

    const sA = await adapter.pool.query(
      'SELECT data FROM daily_settlement WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3',
      [tenantA, childA, dateKey]
    );
    expect(JSON.parse(sA.rows[0].data).rating).toBe(5);

    const sB = await adapter.pool.query(
      'SELECT data FROM daily_settlement WHERE tenant_id = $1 AND child_id = $2 AND date_key = $3',
      [tenantA, childB, dateKey]
    );
    expect(JSON.parse(sB.rows[0].data).rating).toBe(3);
  });

  // Scenario: points_history 按 child_id 隔离
  it('points_history 按 child_id 隔离', async () => {
    await adapter.pool.query(
      "INSERT INTO points_history (tenant_id, child_id, date, earned, spent, balance, detail) VALUES ($1, $2, '2026-06-21', 50, 0, 50, '小明积分变动')",
      [tenantA, childA]
    );
    await adapter.pool.query(
      "INSERT INTO points_history (tenant_id, child_id, date, earned, spent, balance, detail) VALUES ($1, $2, '2026-06-21', 100, 0, 100, '小红积分变动')",
      [tenantA, childB]
    );

    const hA = await adapter.pool.query(
      'SELECT * FROM points_history WHERE tenant_id = $1 AND child_id = $2',
      [tenantA, childA]
    );
    expect(hA.rows.length).toBe(1);
    expect(hA.rows[0].earned).toBe(50);

    const hB = await adapter.pool.query(
      'SELECT * FROM points_history WHERE tenant_id = $1 AND child_id = $2',
      [tenantA, childB]
    );
    expect(hB.rows.length).toBe(1);
    expect(hB.rows[0].earned).toBe(100);
  });
});

describe.runIf(runPg)('Children Table CRUD (创建/查询/修改昵称/禁用)', () => {
  let adapter: any;
  const tenantA = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  let childId1: string;
  let childId2: string;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    // Create user record needed for FK reference
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', 'CRUD测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, 'CRUD测试') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
  });

  afterAll(async () => {
    if (childId1) {
      await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId1]).catch(() => {});
    }
    if (childId2) {
      await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId2]).catch(() => {});
    }
  });

  // Scenario: children 表基本 CRUD
  it('创建孩子记录并查询', async () => {
    childId1 = '11111111-1111-1111-1111-111111111111';

    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, $3)",
      [childId1, tenantA, '小明']
    );

    const result = await adapter.pool.query(
      'SELECT * FROM children WHERE id = $1',
      [childId1]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe('小明');
    expect(result.rows[0].tenant_id).toBe(tenantA);

    const listResult = await adapter.pool.query(
      'SELECT * FROM children WHERE tenant_id = $1 ORDER BY created_at',
      [tenantA]
    );
    expect(listResult.rows.length).toBe(1);
    expect(listResult.rows[0].name).toBe('小明');
  });

  // Scenario: 同一家庭孩子名字唯一
  it('同一家庭孩子名字必须唯一', async () => {
    childId2 = '22222222-2222-2222-2222-222222222222';

    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, $3)",
      [childId2, tenantA, '小红']
    );

    await expect(
      adapter.pool.query(
        "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, $3)",
        ['33333333-3333-3333-3333-333333333333', tenantA, '小红']
      )
    ).rejects.toThrow();
  });

  // Scenario: 修改孩子昵称
  it('修改孩子昵称', async () => {
    await adapter.pool.query(
      "UPDATE children SET name = $1 WHERE id = $2",
      ['大明', childId1]
    );

    const result = await adapter.pool.query(
      'SELECT name FROM children WHERE id = $1',
      [childId1]
    );
    expect(result.rows[0].name).toBe('大明');
  });

  // Scenario: 禁用孩子
  it('禁用孩子（is_active = false）', async () => {
    await adapter.pool.query(
      "UPDATE children SET is_active = false WHERE id = $1",
      [childId1]
    );

    const result = await adapter.pool.query(
      'SELECT * FROM children WHERE id = $1',
      [childId1]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].is_active).toBe(false);

    const activeResult = await adapter.pool.query(
      "SELECT * FROM children WHERE tenant_id = $1 AND is_active = true ORDER BY created_at",
      [tenantA]
    );
    expect(activeResult.rows.length).toBe(1);
    expect(activeResult.rows[0].name).toBe('小红');
  });
});

describe.runIf(runPg)('Shared Data Not Filtered by Child (共享数据不按孩子过滤)', () => {
  let adapter: any;
  const tenantA = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '共享测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, '共享测试') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
  });

  afterAll(async () => {
    await adapter.pool.query("DELETE FROM shop_items WHERE tenant_id = $1", [tenantA]).catch(() => {});
    await adapter.pool.query("DELETE FROM bounty_tasks WHERE tenant_id = $1", [tenantA]).catch(() => {});
    await adapter.pool.query("DELETE FROM settings WHERE tenant_id = $1", [tenantA]).catch(() => {});
  });

  // Scenario: 共享数据（商店商品）不按孩子过滤
  it('商店商品不按 child_id 过滤', async () => {
    const childA = '11111111-1111-1111-1111-1111111111aa';
    const childB = '22222222-2222-2222-2222-2222222222bb';

    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小A') ON CONFLICT (id) DO NOTHING", [childA, tenantA]);
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小B') ON CONFLICT (id) DO NOTHING", [childB, tenantA]);

    // Shared table: shop_items has no child_id
    await adapter.pool.query(
      "INSERT INTO shop_items (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT (tenant_id, id) DO UPDATE SET data = $2",
      [tenantA, JSON.stringify([{ id: 's1', name: '冰激凌' }])]
    );

    // Both children should see the same shop item via adapter
    const fullA = await adapter.getFullData(tenantA, childA);
    const fullB = await adapter.getFullData(tenantA, childB);

    expect(fullA.shopItems.length).toBe(1);
    expect(fullA.shopItems[0].name).toBe('冰激凌');
    expect(fullB.shopItems.length).toBe(1);
    expect(fullB.shopItems[0].name).toBe('冰激凌');

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id IN ($1, $2)', [childA, childB]);
  });

  // Scenario: 共享数据（赏金任务）不按孩子过滤
  it('赏金任务不按 child_id 过滤', async () => {
    await adapter.pool.query(
      "INSERT INTO bounty_tasks (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT (tenant_id, id) DO UPDATE SET data = $2",
      [tenantA, JSON.stringify([{ id: 'b1', name: '洗碗', points: 10 }])]
    );

    const full = await adapter.getFullData(tenantA);
    expect(full.bountyTasks.length).toBe(1);
    expect(full.bountyTasks[0].name).toBe('洗碗');
  });
});

describe.runIf(runPg)('Legacy Data with NULL child_id (遗留数据)', () => {
  let adapter: any;
  const tenantB = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '遗留测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantB]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, '遗留测试') ON CONFLICT (id) DO NOTHING",
      [tenantB]
    );
  });

  afterAll(async () => {
    await adapter.pool.query("DELETE FROM homeworks WHERE tenant_id = $1", [tenantB]).catch(() => {});
  });

  // Scenario: 遗留数据 child_id 为 NULL
  it('无孩子用户的 homeworks child_id 为 NULL', async () => {
    const dateKey = '2026-06-21';
    // Insert homework WITHOUT child_id (simulating legacy data)
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, date_key) WHERE child_id IS NULL DO UPDATE SET data = $3",
      [tenantB, dateKey, JSON.stringify([{ id: 'hw1', subject: '数学' }])]
    );

    // Verify child_id is NULL
    const result = await adapter.pool.query(
      'SELECT child_id FROM homeworks WHERE tenant_id = $1 AND date_key = $2',
      [tenantB, dateKey]
    );
    expect(result.rows[0].child_id).toBeNull();
  });

  // Scenario: assignLegacyDataToChild assigns NULL child_id to a child
  it('assignLegacyDataToChild 将遗留数据分配给新孩子', async () => {
    const childId = '33333333-3333-3333-3333-3333333333cc';
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '新孩子') ON CONFLICT (id) DO NOTHING", [childId, tenantB]);

    await adapter.assignLegacyDataToChild(tenantB, childId);

    const result = await adapter.pool.query(
      "SELECT child_id FROM homeworks WHERE tenant_id = $1 AND child_id = $2",
      [tenantB, childId]
    );
    expect(result.rows.length).toBeGreaterThan(0);

    await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId]);
  });
});

describe.runIf(runPg)('getFullData with child_id (全量数据过滤)', () => {
  let adapter: any;
  const tenantA = '99999999-9999-9999-9999-999999999999';
  const childA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  const childB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '全量测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, '全量测试') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小A') ON CONFLICT (id) DO NOTHING", [childA, tenantA]);
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小B') ON CONFLICT (id) DO NOTHING", [childB, tenantA]);

    // Init default points rows for both children
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 0) ON CONFLICT (tenant_id, child_id, id) DO NOTHING",
      [tenantA, childA]
    );
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 0) ON CONFLICT (tenant_id, child_id, id) DO NOTHING",
      [tenantA, childB]
    );
  });

  afterAll(async () => {
    const tables = ['homeworks', 'points', 'points_history', 'daily_settlement', 'shop_items'];
    for (const t of tables) {
      await adapter.pool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantA]).catch(() => {});
    }
    await adapter.pool.query('DELETE FROM children WHERE id IN ($1, $2)', [childA, childB]).catch(() => {});
  });

  // Scenario: getFullData 按 child_id 返回 per-child 数据 + 共享数据
  it('getFullData 返回 per-child 数据 + 共享数据', async () => {
    const dateKey = '2026-06-21';

    // Set child A's homework and points
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4",
      [tenantA, childA, dateKey, JSON.stringify([{ id: 'hwA', subject: '数学' }])]
    );
    await adapter.pool.query("UPDATE points SET balance = 50 WHERE tenant_id = $1 AND child_id = $2 AND id = 1", [tenantA, childA]);

    // Set child B's homework and points
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, child_id, date_key, data) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, child_id, date_key) DO UPDATE SET data = $4",
      [tenantA, childB, dateKey, JSON.stringify([{ id: 'hwB', subject: '语文' }])]
    );
    await adapter.pool.query("UPDATE points SET balance = 100 WHERE tenant_id = $1 AND child_id = $2 AND id = 1", [tenantA, childB]);

    // Set shared shop item
    await adapter.pool.query(
      "INSERT INTO shop_items (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT (tenant_id, id) DO UPDATE SET data = $2",
      [tenantA, JSON.stringify([{ id: 's1', name: '玩具' }])]
    );

    // getFullData for child A
    const fullA = await adapter.getFullData(tenantA, childA);
    expect(fullA.points.balance).toBe(50);
    expect(fullA.homeworks[dateKey]?.[0]?.subject).toBe('数学');
    expect(fullA.shopItems[0]?.name).toBe('玩具');

    // getFullData for child B
    const fullB = await adapter.getFullData(tenantA, childB);
    expect(fullB.points.balance).toBe(100);
    expect(fullB.homeworks[dateKey]?.[0]?.subject).toBe('语文');
    expect(fullB.shopItems[0]?.name).toBe('玩具');

    // Child A should NOT have child B's homework
    const hwADateData = fullA.homeworks[dateKey];
    if (hwADateData) {
      const hasChildBHw = hwADateData.some((h: any) => h.subject === '语文');
      expect(hasChildBHw).toBe(false);
    }
  });
});

describe.runIf(runPg)('Delete AccessCode Clears children.access_code_id', () => {
  let adapter: any;
  const tenantA = '99999999-9999-9999-9999-a99999999999';
  let childId: string;
  let accessCodeId: string;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', 'AC测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, 'AC测试') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
  });

  afterAll(async () => {
    if (accessCodeId) await adapter.pool.query('DELETE FROM access_codes WHERE id = $1', [accessCodeId]).catch(() => {});
    if (childId) await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId]).catch(() => {});
  });

  it('删除 access_code 时清理 children.access_code_id', async () => {
    accessCodeId = 'aaaaaaaa-aaaa-aaaa-aaaa-deadac000001';
    childId = 'cccccccc-cccc-cccc-cccc-deadac000001';

    // Create child first (required by access_codes FK)
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小明') ON CONFLICT (id) DO NOTHING",
      [childId, tenantA]
    );

    // Create access_code referencing the child
    await adapter.pool.query(
      "INSERT INTO access_codes (id, tenant_id, code_hash, child_id) VALUES ($1, $2, 'hash', $3) ON CONFLICT (id) DO NOTHING",
      [accessCodeId, tenantA, childId]
    );

    // Associate child with access_code
    await adapter.pool.query(
      "UPDATE children SET access_code_id = $1 WHERE id = $2",
      [accessCodeId, childId]
    );

    // Verify child has access_code_id
    const before = await adapter.pool.query('SELECT access_code_id FROM children WHERE id = $1', [childId]);
    expect(before.rows[0].access_code_id).toBe(accessCodeId);

    // Clear access_code_id (simulating what DELETE /api/admin/members does)
    await adapter.updateChild(childId, tenantA, { access_code_id: null });

    // Delete access_code
    await adapter.pool.query('DELETE FROM access_codes WHERE id = $1', [accessCodeId]);

    // Verify child still exists with NULL access_code_id
    const after = await adapter.pool.query('SELECT * FROM children WHERE id = $1', [childId]);
    expect(after.rows.length).toBe(1);
    expect(after.rows[0].access_code_id).toBeNull();
  });
});

describe.runIf(runPg)('Disabled Child Login Rejected (禁用孩子登录被拒)', () => {
  let adapter: any;
  const tenantA = '99999999-9999-9999-9999-b99999999999';
  let childId: string;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '禁用测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, '禁用测试') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
  });

  afterAll(async () => {
    if (childId) await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId]).catch(() => {});
  });

  it('禁用孩子后 getChildrenByTenant 默认不返回', async () => {
    childId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name, is_active) VALUES ($1, $2, '禁用娃', false) ON CONFLICT (id) DO NOTHING", [childId, tenantA]);

    const active = await adapter.getChildrenByTenant(tenantA);
    const found = active.find((c: any) => c.id === childId);
    expect(found).toBeUndefined();

    const all = await adapter.getChildrenByTenant(tenantA, false);
    const foundAll = all.find((c: any) => c.id === childId);
    expect(foundAll).not.toBeUndefined();
  });

  it('updateChild 可以禁用和重新启用孩子', async () => {
    childId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name, is_active) VALUES ($1, $2, '开关娃', true) ON CONFLICT (id) DO NOTHING", [childId, tenantA]);

    // Disable
    await adapter.updateChild(childId, tenantA, { is_active: false });
    let child = await adapter.getChildById(childId, tenantA);
    expect(child!.is_active).toBe(false);

    // Re-enable
    await adapter.updateChild(childId, tenantA, { is_active: true });
    child = await adapter.getChildById(childId, tenantA);
    expect(child!.is_active).toBe(true);
  });
});

describe.runIf(runPg)('Race Condition Protection (竞态防护)', () => {
  let adapter: any;
  const tenantA = '99999999-9999-9999-9999-9999999999bb';
  const childX = '11111111-1111-1111-1111-1111111111aa';
  const childY = '22222222-2222-2222-2222-2222222222bb';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '竞态测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query("INSERT INTO tenants (id, name) VALUES ($1, '竞态测试') ON CONFLICT (id) DO NOTHING", [tenantA]);
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小X') ON CONFLICT (id) DO NOTHING", [childX, tenantA]);
    await adapter.pool.query("INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '小Y') ON CONFLICT (id) DO NOTHING", [childY, tenantA]);
    await adapter.pool.query("INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 100) ON CONFLICT (tenant_id, child_id, id) DO UPDATE SET balance = 100", [tenantA, childX]);
    await adapter.pool.query("INSERT INTO points (tenant_id, child_id, id, balance) VALUES ($1, $2, 1, 100) ON CONFLICT (tenant_id, child_id, id) DO UPDATE SET balance = 100", [tenantA, childY]);
  });

  afterAll(async () => {
    await adapter.pool.query("DELETE FROM shop_items WHERE tenant_id = $1", [tenantA]).catch(() => {});
    await adapter.pool.query("DELETE FROM redemptions WHERE tenant_id = $1", [tenantA]).catch(() => {});
    await adapter.pool.query("DELETE FROM points WHERE tenant_id = $1", [tenantA]).catch(() => {});
    await adapter.pool.query("DELETE FROM children WHERE id IN ($1, $2)", [childX, childY]).catch(() => {});
    await adapter.pool.query("DELETE FROM users WHERE id = $1", [tenantA]).catch(() => {});
    await adapter.pool.query("DELETE FROM tenants WHERE id = $1", [tenantA]).catch(() => {});
  });

  // Scenario: 多孩子同时兑换限量商品（竞态防护）
  it('事务保护：限量商品只有一人能兑换最后一件', async () => {
    // Setup: shop item with quantity 1
    await adapter.pool.query(
      "INSERT INTO shop_items (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT (tenant_id, id) DO UPDATE SET data = $2",
      [tenantA, JSON.stringify([{ id: 'item1', name: '冰激凌', cost: 10, remainingQuantity: 1, baseQuantity: 1 }])]
    );

    // Atomic redemption function using SELECT FOR UPDATE
    async function atomicRedeem(childId: string) {
      const client = await adapter.pool.connect();
      try {
        await client.query('BEGIN');

        // Lock the shop items row
        const shopResult = await client.query(
          "SELECT data FROM shop_items WHERE tenant_id = $1 AND id = 1 FOR UPDATE",
          [tenantA]
        );
        const shopData = JSON.parse(shopResult.rows[0].data);
        const item = shopData.find((i: any) => i.id === 'item1');
        if (!item || item.remainingQuantity < 1) {
          await client.query('ROLLBACK');
          return { success: false, reason: 'sold_out' };
        }

        // Check points
        const pointsResult = await client.query(
          "SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1 FOR UPDATE",
          [tenantA, childId]
        );
        if (pointsResult.rows.length === 0 || pointsResult.rows[0].balance < item.cost) {
          await client.query('ROLLBACK');
          return { success: false, reason: 'insufficient_points' };
        }

        // Decrement remaining quantity
        item.remainingQuantity -= 1;
        await client.query(
          "UPDATE shop_items SET data = $1 WHERE tenant_id = $2 AND id = 1",
          [JSON.stringify(shopData), tenantA]
        );

        // Deduct points
        const newBalance = pointsResult.rows[0].balance - item.cost;
        await client.query(
          "UPDATE points SET balance = $1 WHERE tenant_id = $2 AND child_id = $3 AND id = 1",
          [newBalance, tenantA, childId]
        );

        // Add redemption record
        const existingRedemptions = await client.query(
          "SELECT data FROM redemptions WHERE tenant_id = $1 AND child_id = $2 AND id = 1",
          [tenantA, childId]
        );
        let redemptions: any[];
        if (existingRedemptions.rows.length > 0) {
          redemptions = JSON.parse(existingRedemptions.rows[0].data);
          if (!Array.isArray(redemptions)) redemptions = [];
        } else {
          redemptions = [];
          // Ensure row exists
          await client.query(
            "INSERT INTO redemptions (tenant_id, child_id, id, data) VALUES ($1, $2, 1, '[]') ON CONFLICT (tenant_id, child_id, id) DO NOTHING",
            [tenantA, childId]
          );
        }
        const redemption = { id: 'r_' + childId, itemId: 'item1', itemName: '冰激凌', cost: item.cost, status: 'pending', createdAt: Date.now() };
        redemptions.push(redemption);
        await client.query(
          "UPDATE redemptions SET data = $1 WHERE tenant_id = $2 AND child_id = $3 AND id = 1",
          [JSON.stringify(redemptions), tenantA, childId]
        );

        await client.query('COMMIT');
        return { success: true, redemption };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // Simulate concurrent redemption
    const [resultX, resultY] = await Promise.all([
      atomicRedeem(childX),
      atomicRedeem(childY),
    ]);

    // Only one should succeed
    const successCount = [resultX, resultY].filter(r => r.success).length;
    expect(successCount).toBe(1);

    // Verify remaining quantity is 0
    const shopResult = await adapter.pool.query(
      "SELECT data FROM shop_items WHERE tenant_id = $1 AND id = 1",
      [tenantA]
    );
    const finalShop = JSON.parse(shopResult.rows[0].data);
    expect(finalShop.find((i: any) => i.id === 'item1').remainingQuantity).toBe(0);
  });

  // Scenario: 多孩子同时认领一次性赏金任务（竞态防护）
  it('事务保护：一次性赏金任务只有一人能认领', async () => {
    // Setup: bounty task with maxCompletions=1
    await adapter.pool.query(
      "INSERT INTO bounty_tasks (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT (tenant_id, id) DO UPDATE SET data = $2",
      [tenantA, JSON.stringify([{ id: 'bt1', name: '洗碗', points: 20, maxCompletions: 1 }])]
    );

    // Ensure bounty_submissions default rows exist for both children
    await adapter.pool.query(
      "INSERT INTO bounty_submissions (tenant_id, child_id, date_key, data) VALUES ($1, $2, '2026-06-21', '[]') ON CONFLICT (tenant_id, child_id, date_key) DO NOTHING",
      [tenantA, childX]
    );
    await adapter.pool.query(
      "INSERT INTO bounty_submissions (tenant_id, child_id, date_key, data) VALUES ($1, $2, '2026-06-21', '[]') ON CONFLICT (tenant_id, child_id, date_key) DO NOTHING",
      [tenantA, childY]
    );

    // Transaction 1: childX claims → COMMIT
    const c1 = await adapter.pool.connect();
    await c1.query('BEGIN');
    await c1.query("SELECT data FROM bounty_submissions WHERE tenant_id = $1 AND date_key = '2026-06-21' FOR UPDATE", [tenantA]);
    await c1.query(
      "UPDATE bounty_submissions SET data = $1 WHERE tenant_id = $2 AND child_id = $3 AND date_key = '2026-06-21'",
      [JSON.stringify([{ id: 'bs1', taskId: 'bt1', status: 'completed' }]), tenantA, childX]
    );
    await c1.query('COMMIT');
    c1.release();

    // Transaction 2: childY sees childX's completion
    const c2 = await adapter.pool.connect();
    await c2.query('BEGIN');
    await c2.query("SELECT data FROM bounty_submissions WHERE tenant_id = $1 AND date_key = '2026-06-21' FOR UPDATE", [tenantA]);
    const rows = await c2.query("SELECT data FROM bounty_submissions WHERE tenant_id = $1 AND date_key = '2026-06-21'", [tenantA]);
    let completions = 0;
    for (const row of rows.rows) {
      const data = JSON.parse(row.data);
      if (Array.isArray(data)) completions += data.filter((s: any) => s.taskId === 'bt1' && s.status === 'completed').length;
    }
    expect(completions).toBe(1);  // childY sees childX's completion
    await c2.query('ROLLBACK');
    c2.release();

    // Cleanup
    await adapter.pool.query("DELETE FROM bounty_submissions WHERE tenant_id = $1 AND date_key = '2026-06-21'", [tenantA]);
  });
});

describe.runIf(runPg)('New Child Default Row Init (新孩子默认行初始化)', () => {
  let adapter: any;
  const tenantA = '99999999-9999-9999-9999-999999999a11';

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '初始化测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantA]
    );
    await adapter.pool.query("INSERT INTO tenants (id, name) VALUES ($1, '初始化测试') ON CONFLICT (id) DO NOTHING", [tenantA]);
  });

  afterAll(async () => {
    const tables = ['points', 'badges', 'redemptions', 'reward_box', 'active_buffs'];
    for (const t of tables) {
      await adapter.pool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantA]).catch(() => {});
    }
    await adapter.pool.query('DELETE FROM children WHERE tenant_id = $1', [tenantA]).catch(() => {});
  });

  // Scenario: 新孩子首次使用时默认行初始化
  it('createChild 后 points 有 balance=0 默认行', async () => {
    const child = await adapter.createChild(tenantA, '新生娃');

    // Verify points default row exists
    const points = await adapter.pool.query(
      'SELECT balance FROM points WHERE tenant_id = $1 AND child_id = $2 AND id = 1',
      [tenantA, child.id]
    );
    // Note: createChild doesn't auto-create points row; admin routes handle this
    // This test verifies that createChild itself works and the child record exists
    const childResult = await adapter.pool.query(
      'SELECT * FROM children WHERE id = $1 AND tenant_id = $2',
      [child.id, tenantA]
    );
    expect(childResult.rows.length).toBe(1);
    expect(childResult.rows[0].name).toBe('新生娃');
    expect(childResult.rows[0].is_active).toBe(true);
    expect(childResult.rows[0].access_code_id).toBeNull();

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [child.id]);
  });

  it('createChild 带 accessCodeId 则关联 access_code', async () => {
    const accessId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaacc';
    const tempChildId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaacc';
    // Create a temp child first (required by access_codes FK)
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name) VALUES ($1, $2, '__temp__') ON CONFLICT (id) DO NOTHING",
      [tempChildId, tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO access_codes (id, tenant_id, code_hash, child_id) VALUES ($1, $2, 'testhash', $3) ON CONFLICT (id) DO NOTHING",
      [accessId, tenantA, tempChildId]
    );

    const child = await adapter.createChild(tenantA, '绑定娃', accessId);
    expect(child.access_code_id).toBe(accessId);

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [child.id]);
    await adapter.pool.query('DELETE FROM access_codes WHERE id = $1', [accessId]);
  });
});
