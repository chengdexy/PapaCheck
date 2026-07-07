-- cloudbase-rls.sql
-- CloudBase PG 行级安全（RLS）策略
--
-- 适用环境: CloudBase PG (postgres-9pagpv9i)
-- 环境 ID:  child-teacher-parent-d9aef9d2208
--
-- 策略说明:
--   tenant_isolation  按 tenant_id 隔离租户（必匹配）
--   child_isolation   按 child_id 隔离孩子（child_id 为 NULL 的共享行所有孩子可见）
--
-- 注意:
--   shop_items / bounty_tasks / notifications 三张表为租户级共享表，
--   schema 中不含 child_id 列。执行 child_isolation 策略前需先为这三张表
--   增加 child_id 列（UUID NULL），否则 CREATE POLICY 会因列不存在而失败。
--   详见迁移报告。

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
