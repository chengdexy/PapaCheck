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
  token_version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, nickname)
);

-- 为 users 表添加新列（如果缺失）
ALTER TABLE users ADD COLUMN IF NOT EXISTS family_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login BOOLEAN DEFAULT false;

-- 更新 users 表约束：允许新角色，旧字段改为可空
ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN nickname DROP NOT NULL;
ALTER TABLE users ALTER COLUMN access_hash DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('parent', 'child', 'admin', 'user'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_tenant_id_nickname;

-- ============================================================
-- Step 2: 数据迁移
-- ============================================================

-- 2a. 将 tenants 表转换为 role='user' 账号
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

-- 2c. 处理超级管理员（已有 is_super_admin=true 的用户）
UPDATE users
SET role = 'admin', first_login = false
WHERE is_super_admin = true;

-- 2d. 将有邮箱的家长用户转为 user 账号
UPDATE users
SET role = 'user', first_login = false
WHERE role = 'parent'
  AND email IS NOT NULL
  AND is_active = true;

-- 2e. 将剩余 parent/child 迁移到 access_codes（包括新 user 账号下的）
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
  AND u.is_active = true
  AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id = u.tenant_id AND u2.role = 'user')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Step 3: 记录迁移版本
-- ============================================================

-- 记录迁移版本到 meta 表
INSERT INTO meta (tenant_id, key, value)
SELECT id, 'schema_version', 'v2' FROM users WHERE role = 'user' LIMIT 1
ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'v2';
