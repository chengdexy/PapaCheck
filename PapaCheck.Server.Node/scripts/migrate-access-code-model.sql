-- 数据库迁移脚本：access_codes 模型重构
-- 目标：user_id → tenant_id，添加 child_id，删除 type 和 nickname
-- 执行前请确保已备份数据库

-- Step 0: access_codes.user_id → access_codes.tenant_id
ALTER TABLE access_codes RENAME COLUMN user_id TO tenant_id;
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_tenant_id_fkey;
ALTER TABLE access_codes ADD CONSTRAINT access_codes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES users(id);

-- Step 1: Add child_id column
ALTER TABLE access_codes ADD COLUMN child_id UUID REFERENCES children(id);

-- Step 2: Data migration — populate child_id for existing records
UPDATE access_codes ac SET child_id = c.id
FROM children c
WHERE c.tenant_id = ac.tenant_id AND c.access_code_id = ac.id
  AND ac.child_id IS NULL;

-- Step 3: Make child_id NOT NULL after data migration
-- ALTER TABLE access_codes ALTER COLUMN child_id SET NOT NULL;

-- Step 4: Remove type and nickname
ALTER TABLE access_codes DROP COLUMN type;
ALTER TABLE access_codes DROP COLUMN nickname;

-- Step 5: Drop old unique constraint (was on user_id, nickname)
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_user_id_nickname_key;
