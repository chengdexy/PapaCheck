# 多孩子迁移数据可靠性验证方案

> 最后更新：2026-06-22

## 概述

多孩子管理架构（Phase 1+2）已完成开发并经过本地测试，但生产环境（单家庭 `914724771@qq.com`）尚未执行数据迁移。本文档定义了上线前验证数据迁移可靠性的完整方案。

**原则**：全程不访问生产环境，由用户提供生产数据库备份用于离线验证。

## 架构变更摘要

### Schema 变更
- 新增 `children` 表：`id`, `tenant_id`, `name`, `avatar`, `access_code_id`, `is_active`
- 12 张 per-child 表添加 `child_id` 列 + partial unique index（`WHERE child_id IS NULL`）
- `access_codes` 表重构：`user_id` → `tenant_id`，新增 `child_id`，删除 `type`/`nickname`

### Per-child 表清单
```
homeworks, daily_settlement, efficiency_history, free_time_tasks,
bounty_submissions, bounty_completions, points, points_history,
redemptions, reward_box, active_buffs, badges
```

### 共享表（不分配 child_id）
```
shop_items, settings, bounty_tasks, email_config
```

## 验证方案

### 方案 B：TDD 数据完整性测试矩阵（先做）

编写一套自动化测试，覆盖所有数据迁移边界情况。

| 测试文件 | 覆盖场景 | 预计测试数 |
|---------|---------|-----------|
| `multi-child-schema.test.ts` | Schema 变更正确性 | ~8 |
| `multi-child-data-assignment.test.ts` | 数据分配正确性 | ~10 |
| `multi-child-idempotency.test.ts` | 幂等性 | ~5 |
| `multi-child-reversibility.test.ts` | 可回滚性 | ~4 |

**总计约 27 个 TDD 测试**。

### 方案 A：生产备份回退验证（后做）

用户提供生产 PG 备份后，本地执行完整迁移验证。

```
备份 → pg_restore → 运行迁移 SQL → 启动测试服务器 → 全量测试 → E2E 人工验证
```

## 测试详细设计

### 1. Schema 变更测试 (`multi-child-schema.test.ts`)

```
Scenario: children 表存在且结构正确
  Given 迁移脚本已执行
  When 查询 information_schema.columns
  Then children 表含 id, tenant_id, name, avatar, access_code_id, is_active, created_at 列
  And tenant_id 被 FK 约束到 users(id)

Scenario: 12 张 per-child 表含 child_id 列
  Given 迁移脚本已执行
  When 查询每张 per-child 表的列信息
  Then 每张表都有 child_id 列（UUID 类型，可空）

Scenario: partial unique index 存在
  Given 迁移脚本已执行
  When 查询 pg_indexes
  Then homeworks 表有 (tenant_id, date_key) 的唯一索引 WHERE child_id IS NULL

Scenario: access_codes 表结构正确
  Given 迁移脚本已执行
  When 查询 access_codes 表
  Then 含 tenant_id, child_id, code_hash, access_code, token_version, last_login, created_at
  And 不含 type, nickname 列
  And child_id 被 FK 约束到 children(id)
```

### 2. 数据分配测试 (`multi-child-data-assignment.test.ts`)

```
Scenario: 有孩子的 tenant 所有遗留数据正确分配
  Given tenant A 有 legacy 数据（child_id IS NULL）在 12 张 per-child 表中
  And 已创建 children 记录
  When assignLegacyDataToChild 执行
  Then 所有 per-child 表的 child_id 从 NULL 更新为指定 child_id
  And points.balance 保持不变
  And points_history 每行都分配了 child_id

Scenario: 共享表不被分配 child_id
  Given shop_items/settings/bounty_tasks/email_config 原有 child_id IS NULL
  When assignLegacyDataToChild 执行
  Then 这些表的 child_id 保持 NULL

Scenario: points 表迁移前后余额一致
  Given points 表有 balance = N
  When 迁移执行
  Then balance 仍然是 N
  And child_id 已填充

Scenario: 无孩子的 tenant 数据保持 NULL
  Given tenant B 无 children 记录
  When assignLegacyDataToChild 执行
  Then 所有 per-child 表的 child_id 保持 NULL
```

### 3. 幂等性测试 (`multi-child-idempotency.test.ts`)

```
Scenario: assignLegacyDataToChild 重复执行不报错
  Given 已执行一次 assignLegacyDataToChild
  When 再次执行
  Then 不抛出异常
  And 所有数据行的 child_id 保持不变

Scenario: 重复执行不产生重复行
  Given 已执行一次迁移
  When 再次执行
  Then 12 张 per-child 表的行数不变
```

### 4. 可回滚性测试 (`multi-child-reversibility.test.ts`)

```
Scenario: 迁移 SQL 支持逆向操作
  Given 迁移脚本已执行
  When 执行回滚 SQL（DROP child_id 列、DROP partial unique index、恢复 access_codes 旧结构）
  Then 不报错
  And 查询 information_schema 确认已回滚
```

## 实施流程

### Step 1: TDD 测试矩阵（你确认后立即开始）

1. 按 TDD 流程（RED → GREEN → REFACTOR）逐个编写测试文件
2. 测试在本地 PG 测试环境运行（现有 `DATABASE_URL` 指向的测试库）
3. 每个测试先确认 FAIL，再实现，再确认 PASS

### Step 2: 你提供生产备份

1. 从生产服务器下载最新 PG 备份（`pg_dump -U papacheck papacheck > papacheck_backup.sql`）
2. 提供给我本地恢复

### Step 3: 备份验证

1. 本地恢复备份到独立数据库
2. 运行迁移 SQL + 全量测试
3. 人工 E2E 验证

### Step 4: 安全上线

1. 生产服务器先全量备份
2. 执行迁移 SQL
3. 部署新代码
4. 验证并观察

## 交付物

- [ ] 4 个测试文件（~27 个 TDD 测试）
- [ ] 备份验证报告
- [ ] 生产上线检查清单
