// Feature: 访问码以孩子为中心
//   Scenario: 迁移后 access_codes 表结构正确
//     Given 数据库已执行迁移脚本
//     When 查询 access_codes 表结构
//     Then 存在 child_id 列
//     And 不存在 type 列
//     And 不存在 nickname 列
//     And 不存在 user_id 列（已改为 tenant_id）

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/papacheck_test';

describe('access_codes 表结构 (迁移后)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    // 确保测试数据库存在并执行迁移
    try {
      const schema = await import('fs').then(fs => fs.readFileSync(require('path').resolve(__dirname, '../../scripts/init-pg-schema.sql'), 'utf-8'));
      await pool.query(schema);
      const migration = await import('fs').then(fs => fs.readFileSync(require('path').resolve(__dirname, '../../scripts/migrate-access-code-model.sql'), 'utf-8'));
      await pool.query(migration);
    } catch (e) {
      // ignore
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test('access_codes 表应包含 child_id, tenant_id 列，不包含 type, nickname, user_id 列', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'access_codes'`
    );
    const columns = result.rows.map((r: any) => r.column_name);

    expect(columns).toContain('child_id');
    expect(columns).toContain('tenant_id');
    expect(columns).not.toContain('type');
    expect(columns).not.toContain('nickname');
    expect(columns).not.toContain('user_id');
  });
});
