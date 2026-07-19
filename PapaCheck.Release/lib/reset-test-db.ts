/** 重置 PG 测试库 schema，供 cloud-publish 测试前调用 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 安全：测试库连接信息一律从环境变量读取，禁止任何硬编码默认值。
// 缺失即明确抛错，避免误连到未知/错误的数据库。
// 注意：此处仅读取，真正的校验/抛错在 main() 内进行，保证模块可被测试正常 import（不触发副作用）。
const testDbUrl = process.env.DATABASE_URL;
const pgSuperPassword = process.env.PG_SUPER_PASSWORD;

async function main(): Promise<void> {
  if (!testDbUrl) {
    throw new Error(
      '缺少环境变量 DATABASE_URL：请提供测试库连接串（如 postgresql://user:pass@host:5432/papacheck_test）',
    );
  }
  if (!pgSuperPassword) {
    throw new Error(
      '缺少环境变量 PG_SUPER_PASSWORD：重置脚本需要超级用户密码以连接 template1 管理库',
    );
  }

  const url = new URL(testDbUrl);
  const testDbName = url.pathname.slice(1);
  // 校验数据库名合法性（PG 不支持 DDL 参数化查询，只能白名单校验）
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(testDbName)) {
    throw new Error(`非法数据库名: "${testDbName}"`);
  }
  // 使用 postgres 超级用户连接 template1（始终存在的管理库）
  const adminUrl = `postgresql://postgres:${pgSuperPassword}@${url.hostname}:${url.port}/template1`;

  const adminPool = new pg.Pool({ connectionString: adminUrl });

  // 终止所有到测试库的连接，否则 DROP DATABASE 会失败
  await adminPool.query(
    `
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid()
  `,
    [testDbName],
  );

  await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  // 授予 papacheck 用户 public schema 的所有权限
  await adminPool.query(`GRANT ALL ON DATABASE "${testDbName}" TO papacheck`);
  const tmpPool = new pg.Pool({
    connectionString: `postgresql://postgres:${pgSuperPassword}@${url.hostname}:${url.port}/${testDbName}`,
  });
  await tmpPool.query('GRANT ALL ON SCHEMA public TO papacheck');
  await tmpPool.query('ALTER SCHEMA public OWNER TO papacheck');
  await tmpPool.end();
  await adminPool.end();

  // 在新库上跑 schema
  const schemaPath = resolve(__dirname, '../../PapaCheck.Server/scripts/init-pg-schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  const testPool = new pg.Pool({ connectionString: testDbUrl });
  await testPool.query(schema);
  await testPool.end();
  console.log('OK');
}

// 仅在作为脚本直接运行时执行 main（被测试 import 时不触发，
// 避免 import 阶段调用 process.exit 造成 vitest 的 unhandled error）。
// 用 resolve 归一化路径，兼容相对 / 绝对两种调用方式。
const invokedDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
