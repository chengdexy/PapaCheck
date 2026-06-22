/** 重置 PG 测试库 schema，供 cloud-publish 测试前调用 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDbUrl = process.env.DATABASE_URL || 'postgresql://papacheck***REDACTED***@localhost:5432/papacheck_test';

async function main() {
  const url = new URL(testDbUrl);
  const testDbName = url.pathname.slice(1);
  // 校验数据库名合法性（PG 不支持 DDL 参数化查询，只能白名单校验）
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(testDbName)) {
    throw new Error(`非法数据库名: "${testDbName}"`);
  }
  url.pathname = '/papacheck';
  const adminUrl = url.toString();

  const adminPool = new pg.Pool({ connectionString: adminUrl });

  // 终止所有到测试库的连接，否则 DROP DATABASE 会失败
  await adminPool.query(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid()
  `, [testDbName]);

  await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  await adminPool.end();

  // 在新库上跑 schema
  const schemaPath = resolve(__dirname, '../../PapaCheck.Server/scripts/init-pg-schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  const testPool = new pg.Pool({ connectionString: testDbUrl });
  await testPool.query(schema);
  await testPool.end();
  console.log('OK');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
