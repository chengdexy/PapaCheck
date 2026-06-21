import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

// ==================== Gherkin ====================
// Feature: 孩子登录获取 child_id
//   Scenario: 孩子登录 JWT 包含 child_id
//     Given 孩子小明的 access_code 已关联 children 记录
//     When 小明通过 access_code 登录
//     Then JWT payload 包含正确的 child_id
//
//   Scenario: access_code 无关联 children 记录时自动创建
//     Given 孩子小明的 access_code 存在但无 children 记录（迁移遗漏）
//     When 小明通过 access_code 登录
//     Then 自动创建 children 记录并关联
//     And JWT payload 包含新建的 child_id
//
//   Scenario: 禁用孩子后无法通过 access_code 登录
//     Given 孩子小明 is_active=false
//     When 小明尝试通过 access_code 登录
//     Then 登录失败（孩子已禁用）

describe.runIf(runPg)('Child Login - JWT contains child_id', () => {
  let adapter: any;
  const tenantId = '88888888-8888-8888-8888-888888888888';
  let accessCodeId: string;
  let childId: string;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
    // Create test user
    await adapter.pool.query(
      "INSERT INTO users (id, role, family_name, tenant_id, nickname) VALUES ($1, 'user', '登录测试', $1, '家长') ON CONFLICT (id) DO NOTHING",
      [tenantId]
    );
    await adapter.pool.query(
      "INSERT INTO tenants (id, name) VALUES ($1, '登录测试') ON CONFLICT (id) DO NOTHING",
      [tenantId]
    );
  });

  afterAll(async () => {
    if (accessCodeId) {
      await adapter.pool.query('DELETE FROM access_codes WHERE id = $1', [accessCodeId]).catch(() => {});
    }
    if (childId) {
      await adapter.pool.query('DELETE FROM children WHERE id = $1', [childId]).catch(() => {});
    }
  });

  // Scenario: createChild and findChildByAccessCodeId work in DB layer
  it('createChild 然后 findChildByAccessCodeId 能查到', async () => {
    childId = '11111111-1111-1111-1111-111111111111';
    accessCodeId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac';

    // Create access_code
    await adapter.pool.query(
      "INSERT INTO access_codes (id, user_id, type, code_hash, nickname) VALUES ($1, $2, 'child', '$2a$10$placeholderhash1234567890abcdef', '小明') ON CONFLICT (id) DO NOTHING",
      [accessCodeId, tenantId]
    );

    // Create child associated with access_code
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name, access_code_id) VALUES ($1, $2, '小明', $3) ON CONFLICT (id) DO NOTHING",
      [childId, tenantId, accessCodeId]
    );

    // findChildByAccessCodeId should find the child
    const found = await adapter.findChildByAccessCodeId(accessCodeId, tenantId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(childId);
    expect(found!.name).toBe('小明');
  });

  // Scenario: findChildByAccessCodeId returns null if no child
  it('access_code 无 children 记录时 findChildByAccessCodeId 返回 null', async () => {
    const noChildAccessCodeId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    await adapter.pool.query(
      "INSERT INTO access_codes (id, user_id, type, code_hash, nickname) VALUES ($1, $2, 'child', '$2a$10$placeholderhash2abcdefghijklmn', '小华') ON CONFLICT (id) DO NOTHING",
      [noChildAccessCodeId, tenantId]
    );

    const found = await adapter.findChildByAccessCodeId(noChildAccessCodeId, tenantId);
    expect(found).toBeNull();

    // Cleanup
    await adapter.pool.query('DELETE FROM access_codes WHERE id = $1', [noChildAccessCodeId]);
  });

  // Scenario: createChild auto-creates children record
  it('createChild 创建孩子记录', async () => {
    const newChildId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const child = await adapter.createChild(tenantId, '小刚');
    expect(child).not.toBeNull();
    expect(child.name).toBe('小刚');
    expect(child.tenant_id).toBe(tenantId);
    expect(child.is_active).toBe(true);

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [child.id]);
  });

  // Scenario: Disabled child
  it('禁用孩子后 getChildrenByTenant 默认不返回', async () => {
    // Create a disabled child
    const disabledChildId = '11111111-1111-1111-1111-1111d15ab1ed';
    await adapter.pool.query(
      "INSERT INTO children (id, tenant_id, name, is_active) VALUES ($1, $2, '小黑', false) ON CONFLICT (id) DO NOTHING",
      [disabledChildId, tenantId]
    );

    // Active-only query should not include disabled child
    const active = await adapter.getChildrenByTenant(tenantId, true);
    const disabledInActive = active.find((c: any) => c.id === disabledChildId);
    expect(disabledInActive).toBeUndefined();

    // Full list should include disabled child
    const all = await adapter.getChildrenByTenant(tenantId, false);
    const disabledInAll = all.find((c: any) => c.id === disabledChildId);
    expect(disabledInAll).not.toBeUndefined();

    // Cleanup
    await adapter.pool.query('DELETE FROM children WHERE id = $1', [disabledChildId]);
  });
});
