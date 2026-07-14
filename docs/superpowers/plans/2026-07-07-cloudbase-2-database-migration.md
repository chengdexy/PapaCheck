# PapaCheck CloudBase 迁移 - 子计划 2：数据库迁移与 RLS 策略

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **文档状态：迁移子计划稿，实施方式已变更（2026-07-14 注记）**
> 本文档是 CloudBase 迁移的**子计划稿（预期方案）**，实际落地已与本文多处不符，阅读时以代码与现状文档（README / ARCHITECTURE / PROGRESS）为准：
> - **实时同步**：本文档描述的 CloudBase PG 实时监听（`watch()`）/ RLS 订阅**未落地**；生产实际为前端 `RealtimeManager` 轻量版本戳短轮询（默认 3 秒轮询 `/api/data-version`，变更才拉全量；写后 burst 提速到 1 秒）。
> - **多租户隔离**：本文档依赖的 **RLS（`cloudbase-rls.sql`）未激活**——后端 `postgres-adapter.ts` 用普通 `pg` 连接，不注入 `request.jwt.claims`；隔离实际由应用层 SQL（`WHERE tenant_id=$1 [AND child_id=$2]`）实现。
> - **TTS**：`tts-svc` 由独立仓库维护，**不在本仓库**（仅 `/api/speak`、`/api/pregen-speech` 经网关转发）。
> - **版本号**：本文档出现的 `v2.0.0` 为设计预期，实际为 Server 1.2.0 / Web 1.5.2 / Android 1.6.6。
> - **表数量**：迁移设计稿原写 26 张表，实际 `init-pg-schema.sql` 建 **27 张表**（本文正文已同步修正为 27）。

**Goal:** 在 CloudBase PG 上创建 27 张表 schema，配置 RLS 行级安全策略，并从 ECS PostgreSQL 迁移生产数据。

**Architecture:** 复用现有 `init-pg-schema.sql` 建表，通过 CloudBase MCP `managePgDatabase` 执行 DDL。RLS 策略让前端实时订阅按 `tenant_id` + `child_id` 隔离，云函数用 service_role 绕过。数据迁移用 `pg_dump` + `pg_restore`。

**Tech Stack:** PostgreSQL 16, CloudBase PG, pg_dump/restore, RLS, JWT claims

**依赖关系：** 无前置依赖，可与子计划 1/4/5 并行开发。子计划 3 的实时监听联调依赖本计划完成。

**Spec 参考：** `docs/superpowers/specs/2026-07-07-cloudbase-migration-design.md` 第五章「数据库与数据迁移」

---

## 文件结构

```
PapaCheck.Server/scripts/
├── init-pg-schema.sql           # 已有，复用
├── migrate-access-code-model.sql # 已有，复用
├── migrate-auth-v2.sql          # 已有，复用
└── cloudbase-rls.sql            # 新建，RLS 策略

PapaCheck.CloudFunc/papacheck-api/
└── scripts/
    └── migrate-data.ps1         # 新建，数据迁移脚本
```

---

### Task 1: 初始化 CloudBase PG 上下文

- [ ] **Step 1: 通过 MCP 初始化 PG 上下文**

调用 `managePgDatabase(action=init)` 绑定当前 CloudBase 环境的 PostgreSQL。

- [ ] **Step 2: 验证上下文就绪**

调用 `queryPgDatabase(action=context)` 确认返回 `status: ready`。

- [ ] **Step 3: 查询当前数据库对象**

调用 `queryPgDatabase(action=objects, limit=20)` 确认 `public` schema 为空（或仅有系统表）。

---

### Task 2: 执行 schema 建表

**Files:**
- Use: `PapaCheck.Server/scripts/init-pg-schema.sql` (已有)

- [ ] **Step 1: 读取 init-pg-schema.sql 内容**

```bash
# PowerShell 读取文件内容（用于后续 MCP 执行）
$sql = Get-Content PapaCheck.Server/scripts/init-pg-schema.sql -Raw
```

- [ ] **Step 2: 通过 MCP 执行建表 SQL**

调用 `managePgDatabase(action=execute, sql=<init-pg-schema.sql 内容>, confirm=true)`。

- [ ] **Step 3: 执行 access-code-model 迁移**

调用 `managePgDatabase(action=execute, sql=<migrate-access-code-model.sql 内容>, confirm=true)`。

- [ ] **Step 4: 执行 auth-v2 迁移**

调用 `managePgDatabase(action=execute, sql=<migrate-auth-v2.sql 内容>, confirm=true)`。

- [ ] **Step 5: 验证表数量**

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';
```
Expected: 27

调用 `queryPgDatabase(action=sql, sql="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")`。

---

### Task 3: 编写 RLS 策略 SQL 文件

**Files:**
- Create: `PapaCheck.Server/scripts/cloudbase-rls.sql`

- [ ] **Step 1: 创建 RLS 策略 SQL 文件**

```sql
-- cloudbase-rls.sql
-- CloudBase PG 行级安全（RLS）策略
-- 用于前端实时订阅时按 tenant_id + child_id 隔离数据

-- ==================== 启用 RLS ====================

ALTER TABLE homeworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE points ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_box ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_buffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE efficiency_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_time_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ==================== 创建策略 ====================
-- RLS 从 request.jwt.claims 读取 tenant_id/child_id

-- homeworks
CREATE POLICY tenant_isolation ON homeworks
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON homeworks
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- daily_settlement
CREATE POLICY tenant_isolation ON daily_settlement
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON daily_settlement
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- points
CREATE POLICY tenant_isolation ON points
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON points
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- points_history
CREATE POLICY tenant_isolation ON points_history
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON points_history
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- shop_items
CREATE POLICY tenant_isolation ON shop_items
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON shop_items
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- redemptions
CREATE POLICY tenant_isolation ON redemptions
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON redemptions
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- reward_box
CREATE POLICY tenant_isolation ON reward_box
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON reward_box
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- bounty_tasks
CREATE POLICY tenant_isolation ON bounty_tasks
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON bounty_tasks
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- bounty_submissions
CREATE POLICY tenant_isolation ON bounty_submissions
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON bounty_submissions
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- bounty_completions
CREATE POLICY tenant_isolation ON bounty_completions
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON bounty_completions
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- active_buffs
CREATE POLICY tenant_isolation ON active_buffs
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON active_buffs
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- efficiency_history
CREATE POLICY tenant_isolation ON efficiency_history
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON efficiency_history
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- free_time_tasks
CREATE POLICY tenant_isolation ON free_time_tasks
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON free_time_tasks
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');

-- notifications
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id::text = current_setting('request.jwt.claims', true)::json->>'tenant_id');
CREATE POLICY child_isolation ON notifications
  USING (child_id IS NULL OR child_id::text = current_setting('request.jwt.claims', true)::json->>'child_id');
```

- [ ] **Step 2: 提交**

```bash
git add PapaCheck.Server/scripts/cloudbase-rls.sql
git commit -m "feat: 新增 CloudBase PG RLS 策略 SQL（14 张表 tenant+child 隔离）"
```

---

### Task 4: 执行 RLS 策略

- [ ] **Step 1: 通过 MCP 执行 RLS SQL**

读取 `cloudbase-rls.sql` 内容，调用 `managePgDatabase(action=execute, sql=<RLS SQL 内容>, confirm=true)`。

- [ ] **Step 2: 验证 RLS 已启用**

```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;
```
Expected: 14 行

调用 `queryPgDatabase(action=sql, sql="SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true")`。

- [ ] **Step 3: 验证策略数量**

```sql
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
```
Expected: 28（14 张表 × 2 策略）

---

### Task 5: 编写数据迁移脚本

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/scripts/migrate-data.ps1`

- [ ] **Step 1: 创建迁移脚本**

```powershell
# migrate-data.ps1
# 从 ECS PostgreSQL 迁移数据到 CloudBase PG

param(
    [Parameter(Mandatory=$true)]
    [string]$CloudBasePgUrl,
    
    [Parameter(Mandatory=$false)]
    [string]$EcsHost = "123.57.129.243",
    
    [Parameter(Mandatory=$false)]
    [string]$EcsUser = "root",
    
    [Parameter(Mandatory=$false)]
    [string]$DumpFile = "$env:TEMP\papacheck.dump"
)

$ErrorActionPreference = "Stop"

Write-Host "=== PapaCheck 数据迁移 ECS → CloudBase PG ===" -ForegroundColor Cyan

# 步骤1: ECS 上导出
Write-Host "[1/4] 从 ECS 导出数据库..." -ForegroundColor Yellow
ssh "$EcsUser@$EcsHost" "sudo -u papacheck pg_dump -Fc -d papacheck -f /tmp/papacheck.dump"
scp "$EcsUser@${EcsHost}:/tmp/papacheck.dump" $DumpFile
Write-Host "  导出完成: $DumpFile" -ForegroundColor Green

# 步骤2: 恢复到 CloudBase PG
Write-Host "[2/4] 恢复到 CloudBase PG..." -ForegroundColor Yellow
pg_restore -d $CloudBasePgUrl --no-owner --no-acl --clean --if-exists $DumpFile
Write-Host "  恢复完成" -ForegroundColor Green

# 步骤3: 行数校验
Write-Host "[3/4] 行数校验..." -ForegroundColor Yellow
$ tables = @("users", "children", "access_codes", "homeworks", "daily_settlement", 
             "points", "points_history", "shop_items", "redemptions", "reward_box",
             "bounty_tasks", "bounty_submissions", "bounty_completions", "active_buffs",
             "notifications", "settings")
foreach ($t in $tables) {
    $count = psql -d $CloudBasePgUrl -t -c "SELECT COUNT(*) FROM $t;"
    Write-Host "  $t : $count 行" -ForegroundColor Gray
}

# 步骤4: 完成提示
Write-Host "[4/4] 迁移完成" -ForegroundColor Green
Write-Host "请手动核对关键表行数与 ECS 一致" -ForegroundColor Yellow
```

- [ ] **Step 2: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/scripts/migrate-data.ps1
git commit -m "feat: 新增数据迁移脚本 migrate-data.ps1"
```

---

### Task 6: 执行数据迁移（预迁移）

- [ ] **Step 1: 获取 CloudBase PG 连接串**

通过 CloudBase 控制台或 MCP 获取 CloudBase PG 公网连接串（用于迁移期间使用）。

- [ ] **Step 2: 执行预迁移脚本**

```bash
$cloudUrl = "postgresql://<user>:<pass>@<cloudbase-pg-host>:<port>/postgres"
.\PapaCheck.CloudFunc\papacheck-api\scripts\migrate-data.ps1 -CloudBasePgUrl $cloudUrl
```

- [ ] **Step 3: 验证行数一致性**

对比 ECS 和 CloudBase PG 的关键表行数：

```sql
-- 在 ECS 上执行
SELECT 'users' as t, COUNT(*) FROM users
UNION ALL SELECT 'children', COUNT(*) FROM children
UNION ALL SELECT 'homeworks', COUNT(*) FROM homeworks
UNION ALL SELECT 'access_codes', COUNT(*) FROM access_codes;

-- 在 CloudBase PG 上执行相同查询，对比结果
```

调用 `queryPgDatabase(action=sql, sql="SELECT 'users' as t, COUNT(*) FROM users UNION ALL SELECT 'children', COUNT(*) FROM children UNION ALL SELECT 'homeworks', COUNT(*) FROM homeworks")`。

- [ ] **Step 4: 验证数据完整性**

```sql
-- 检查孤儿记录
SELECT COUNT(*) FROM homeworks WHERE tenant_id IS NULL;  -- 应为 0
SELECT COUNT(*) FROM access_codes WHERE child_id IS NULL; -- 应为 0
```

---

### Task 7: 编写 RLS 策略验证测试

**Files:**
- Create: `PapaCheck.CloudFunc/papacheck-api/test/rls.test.ts`

- [ ] **Step 1: 写 Gherkin 行为注释**

```typescript
// test/rls.test.ts
// Feature: RLS 行级安全策略
//   Scenario: tenant A 的 JWT 查询不到 tenant B 的数据
//     Given 数据库有 tenant A 和 tenant B 各 1 条 homeworks
//     When 用 tenant A 的 JWT 查询 homeworks
//     Then 只返回 tenant A 的记录
//   Scenario: child A 的 JWT 查询不到 child B 的数据
//     Given 同一 tenant 下有 child A 和 child B 各 1 条 homeworks
//     When 用 child A 的 JWT 查询 homeworks
//     Then 只返回 child A 的记录
test('RLS 策略', () => {});
```

- [ ] **Step 2: 用 AskUserQuestion 向用户确认 Gherkin 场景**

- [ ] **Step 3: 写 RLS 测试（用户确认后）**

```typescript
// test/rls.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL!;
let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

async function setJwtClaims(client: any, tenantId: string, childId?: string) {
  const claims = JSON.stringify({ tenant_id: tenantId, child_id: childId || null });
  await client.query(`SET LOCAL request.jwt.claims = '${claims}'`);
}

describe('RLS 行级安全策略', () => {
  it('tenant A 查询不到 tenant B 的数据', async () => {
    const client = await pool.connect();
    try {
      // 假设测试库有 tenant A 和 B 的数据
      await client.query('BEGIN');
      await setJwtClaims(client, 'tenant-a-id');
      const result = await client.query('SELECT COUNT(*) FROM homeworks WHERE tenant_id = $1', ['tenant-b-id']);
      // RLS 应该过滤掉 tenant B 的数据，即使显式查询
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
      const result = await client.query('SELECT COUNT(*) FROM homeworks WHERE child_id = $1', ['child-b-id']);
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
```

注意：此测试需要在 CloudBase PG 上运行（RLS 策略已配置）。本地测试库需先执行 `cloudbase-rls.sql`。

- [ ] **Step 4: 运行测试验证**

```bash
$env:DATABASE_URL="<CloudBase PG 连接串>"
cd PapaCheck.CloudFunc/papacheck-api && npx vitest run test/rls.test.ts
```
Expected: 3 个测试通过

- [ ] **Step 5: 提交**

```bash
git add PapaCheck.CloudFunc/papacheck-api/test/rls.test.ts
git commit -m "test: 新增 RLS 策略验证测试（tenant/child 隔离）"
```

---

## 完成标准

- [ ] CloudBase PG 上下文已初始化
- [ ] 27 张表已创建（`SELECT COUNT(*) FROM information_schema.tables` = 27）
- [ ] RLS 已在 14 张业务表上启用
- [ ] 28 条 RLS 策略已创建（14 表 × 2 策略）
- [ ] 生产数据已从 ECS 迁移到 CloudBase PG
- [ ] 行数校验通过（ECS vs CloudBase PG 一致）
- [ ] RLS 策略测试通过（tenant/child 隔离正确）

## 后续衔接

- 子计划 1（API 云函数）配置 `DATABASE_URL` 指向 CloudBase PG 后即可联调
- 子计划 3（前端实时监听）依赖 RLS 策略生效才能安全订阅
- 子计划 6（切换）时执行最终数据增量同步
