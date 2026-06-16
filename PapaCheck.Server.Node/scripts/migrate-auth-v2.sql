-- ============================================================
-- migrate-auth-v2.sql
-- 数据库迁移：从旧认证模型迁移到新认证模型 v2
-- 可重复执行（幂等）
-- ============================================================

-- ============================================================
-- Step 1: 结构变更
-- ============================================================

-- 新增 access_codes 表
CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('parent', 'child')),
  code_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, nickname)
);

-- 为 users 表添加新列（如果缺失）
ALTER TABLE users ADD COLUMN IF NOT EXISTS family_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login BOOLEAN DEFAULT false;

-- ============================================================
-- Step 2: 数据迁移
-- ============================================================

-- 2a. 将 tenants 表转换为 role='user' 账号
-- 对每个 tenant，查找其有 email 的管理员用户
INSERT INTO users (id, role, email, password_hash, family_name, first_login, token_version, is_active, created_at)
SELECT
  t.id,
  'user',
  COALESCE(
    (SELECT email FROM users u WHERE u.tenant_id = t.id AND u.email IS NOT NULL LIMIT 1),
    'migrated-' || t.id || '@papacheck.internal'
  ),
  COALESCE(
    (SELECT password_hash FROM users u WHERE u.tenant_id = t.id AND u.password_hash IS NOT NULL LIMIT 1),
    ''
  ),
  t.name,
  false,
  1,
  t.is_active,
  t.created_at
FROM tenants t
ON CONFLICT (id) DO NOTHING;

-- 2b. 将已有 parent/child 用户迁移到 access_codes
INSERT INTO access_codes (id, user_id, type, code_hash, nickname, created_at)
SELECT
  u.id,
  u.tenant_id,
  u.role,
  u.access_hash,
  u.nickname,
  u.created_at
FROM users u
WHERE u.role IN ('parent', 'child')
  AND u.is_active = true;

-- 2c. 处理超级管理员（已有 is_super_admin=true 的用户）
UPDATE users
SET role = 'admin', first_login = false
WHERE is_super_admin = true;

-- ============================================================
-- Step 3: 记录迁移版本
-- ============================================================

-- 记录迁移版本到 meta 表
INSERT INTO meta (tenant_id, key, value)
SELECT id, 'schema_version', 'v2' FROM users WHERE role = 'user' LIMIT 1
ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'v2';
