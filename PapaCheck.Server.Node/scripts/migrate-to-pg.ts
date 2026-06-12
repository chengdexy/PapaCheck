import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlitePath = process.argv[2] || 'data.db';
  const pgUrl = process.env['DATABASE_URL'];

  if (!pgUrl) {
    console.error('请设置 DATABASE_URL 环境变量指定 PostgreSQL 连接地址');
    process.exit(1);
  }

  console.log(`📦 SQLite: ${sqlitePath}`);
  console.log(`🐘 PostgreSQL: ${pgUrl}`);

  // 1. 读取 SQLite 数据
  const sqlite = new Database(sqlitePath);
  sqlite.pragma('journal_mode = WAL');

  // 2. 初始化 PostgreSQL Schema
  const pool = new Pool({ connectionString: pgUrl });
  const schemaPath = resolve(__dirname, 'init-pg-schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
  console.log('✅ Schema 初始化完成');

  // 3. 逐表迁移

  // 3a. 单行 JSON 表
  const singleRowTables = [
    'shop_items', 'redemptions', 'reward_box', 'settings',
    'active_buffs', 'bounty_tasks', 'badges', 'email_config'
  ];
  for (const table of singleRowTables) {
    const row = sqlite.prepare(`SELECT data FROM ${table} WHERE id = 1`).get() as { data: string } | undefined;
    const data = row ? row.data : (table === 'settings' ? '{}' : '[]');
    await pool.query(
      `INSERT INTO ${table} (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1`,
      [data]
    );
    console.log(`  ✅ ${table}`);
  }

  // 3b. points
  const pointsRow = sqlite.prepare('SELECT balance FROM points WHERE id = 1').get() as { balance: number } | undefined;
  if (pointsRow) {
    await pool.query('UPDATE points SET balance = $1 WHERE id = 1', [pointsRow.balance]);
  }
  console.log('  ✅ points');

  // 3c. points_history
  const historyRows = sqlite.prepare('SELECT * FROM points_history ORDER BY id ASC').all() as any[];
  for (const h of historyRows) {
    await pool.query(
      `INSERT INTO points_history (date, earned, spent, balance, detail) VALUES ($1, $2, $3, $4, $5)`,
      [h.date, h.earned, h.spent, h.balance, h.detail]
    );
  }
  console.log(`  ✅ points_history (${historyRows.length} rows)`);

  // 3d. date_key 表
  const dateKeyTables = [
    'homeworks', 'daily_settlement', 'efficiency_history',
    'free_time_tasks', 'bounty_submissions', 'bounty_completions'
  ];
  for (const table of dateKeyTables) {
    const rows = sqlite.prepare(`SELECT date_key, data FROM ${table}`).all() as { date_key: string; data: string }[];
    for (const row of rows) {
      await pool.query(
        `INSERT INTO ${table} (date_key, data) VALUES ($1, $2) ON CONFLICT (date_key) DO UPDATE SET data = $2`,
        [row.date_key, row.data]
      );
    }
    console.log(`  ✅ ${table} (${rows.length} rows)`);
  }

  // 3e. notifications
  const notifRows = sqlite.prepare('SELECT * FROM notifications').all() as any[];
  for (const n of notifRows) {
    await pool.query(
      `INSERT INTO notifications (id, text, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [n.id, n.text, n.created_at]
    );
  }
  console.log(`  ✅ notifications (${notifRows.length} rows)`);

  // 3f. last_modified
  const lmRows = sqlite.prepare('SELECT * FROM last_modified').all() as any[];
  for (const lm of lmRows) {
    await pool.query(
      `INSERT INTO last_modified (table_name, record_key, last_modified) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [lm.table_name, lm.record_key, lm.last_modified]
    );
  }
  console.log(`  ✅ last_modified (${lmRows.length} rows)`);

  // 3g. crdt_operations
  const crdtRows = sqlite.prepare('SELECT * FROM crdt_operations').all() as any[];
  for (const op of crdtRows) {
    await pool.query(
      `INSERT INTO crdt_operations (id, type, table_name, resource_id, field, value, timestamp, node_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [op.id, op.type, op.table_name, op.resource_id, op.field, op.value, op.timestamp, op.node_id]
    );
  }
  console.log(`  ✅ crdt_operations (${crdtRows.length} rows)`);

  // 4. 验证
  console.log('\n📊 行数验证:');
  const allTables = ['points', 'points_history', ...singleRowTables, ...dateKeyTables, 'notifications', 'last_modified', 'crdt_operations'];
  let allOk = true;
  for (const table of allTables) {
    const sqliteCount = (sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any).count;
    const pgResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
    const pgCount = parseInt(pgResult.rows[0].count, 10);
    const ok = sqliteCount === pgCount;
    console.log(`  ${ok ? '✅' : '❌'} ${table}: SQLite=${sqliteCount} → PG=${pgCount}`);
    if (!ok) allOk = false;
  }

  sqlite.close();
  await pool.end();

  if (allOk) {
    console.log('\n✅ 迁移完成，数据完整！');
  } else {
    console.log('\n❌ 迁移完成，但存在行数不一致！');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
