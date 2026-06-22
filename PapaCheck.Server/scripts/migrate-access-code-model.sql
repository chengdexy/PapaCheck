-- 数据库迁移脚本：access_codes 模型重构
-- 目标：user_id → tenant_id，添加 child_id，删除 type 和 nickname
-- 执行前请确保已备份数据库
--
-- 注意：必须先执行 init-pg-schema.sql（创建 children 表）再执行本脚本

-- Step 0: access_codes.user_id → access_codes.tenant_id
ALTER TABLE access_codes RENAME COLUMN user_id TO tenant_id;
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_tenant_id_fkey;
ALTER TABLE access_codes ADD CONSTRAINT access_codes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES users(id);

-- Step 1: Add child_id column
ALTER TABLE access_codes ADD COLUMN child_id UUID REFERENCES children(id);

-- Step 2: Create children records from old child-type access_codes
-- 利用即将删除的 type/nickname 列创建 children 记录，再关联回 access_codes
INSERT INTO children (id, tenant_id, name, access_code_id)
SELECT gen_random_uuid(), ac.tenant_id, ac.nickname, ac.id
FROM access_codes ac
WHERE ac.type = 'child'
  AND NOT EXISTS (
    SELECT 1 FROM children c
    WHERE c.tenant_id = ac.tenant_id AND c.access_code_id = ac.id
  );

-- Step 3: Populate child_id for existing records（利用上一步创建的 children 记录）
UPDATE access_codes ac SET child_id = c.id
FROM children c
WHERE c.tenant_id = ac.tenant_id AND c.access_code_id = ac.id
  AND ac.child_id IS NULL;

-- Step 3.5: Assign legacy data to each child
-- 将所有 child_id IS NULL 的历史数据分配给对应的 child
DO $$
DECLARE
  child_rec RECORD;
  tables TEXT[] := ARRAY['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks',
                        'bounty_submissions', 'bounty_completions', 'points', 'points_history',
                        'redemptions', 'reward_box', 'active_buffs', 'badges'];
  t TEXT;
BEGIN
  FOR child_rec IN SELECT id, tenant_id FROM children LOOP
    FOREACH t IN ARRAY tables LOOP
      EXECUTE format('UPDATE %I SET child_id = $1::uuid WHERE tenant_id::text = $2::text AND child_id IS NULL', t)
        USING child_rec.id, child_rec.tenant_id;
    END LOOP;
  END LOOP;
END $$;

-- Step 4: Make child_id NOT NULL after data migration
-- ALTER TABLE access_codes ALTER COLUMN child_id SET NOT NULL;

-- Step 5: Remove type and nickname（数据已迁移到 children.name，安全删除）
ALTER TABLE access_codes DROP COLUMN type;
ALTER TABLE access_codes DROP COLUMN nickname;

-- Step 6: Drop old unique constraint (was on user_id, nickname)
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_user_id_nickname_key;
