import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
// 如无 DATABASE_URL 则跳过所有测试
const describeOrSkip = connectionString ? describe : describe.skip;

describeOrSkip('RLS 行级安全策略', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: connectionString!, max: 2 });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function setJwtClaims(client: any, tenantId: string, childId?: string) {
    const claims = JSON.stringify({ tenant_id: tenantId, child_id: childId || null });
    await client.query(`SET LOCAL request.jwt.claims = '${claims}'`);
  }

  it('tenant A 查询不到 tenant B 的数据', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setJwtClaims(client, 'tenant-a-id');
      const result = await client.query("SELECT COUNT(*) FROM homeworks WHERE tenant_id = $1", ['tenant-b-id']);
      expect(Number(result.rows[0].count)).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('child A 查询不到 child B 的数据', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setJwtClaims(client, 'tenant-a-id', 'child-a-id');
      const result = await client.query("SELECT COUNT(*) FROM homeworks WHERE child_id = $1", ['child-b-id']);
      expect(Number(result.rows[0].count)).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('无 JWT claims 时查询返回空', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL request.jwt.claims = '{}'");
      const result = await client.query('SELECT COUNT(*) FROM homeworks');
      expect(Number(result.rows[0].count)).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
