-- PostgreSQL Schema for PapaCheck (Multi-Tenant)

-- ==================== Multi-Tenant Tables ====================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_name TEXT,
  admin_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_name ON tenants(name);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('parent', 'child', 'admin', 'user')),
  email TEXT,
  password_hash TEXT,
  family_name TEXT,
  first_login BOOLEAN DEFAULT true,
  tenant_id UUID,
  nickname TEXT,
  access_hash TEXT,
  access_code TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  is_super_admin BOOLEAN DEFAULT false,
  needs_password_change BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- children must be created before access_codes to resolve circular FK dependency
CREATE TABLE IF NOT EXISTS children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  avatar TEXT,
  access_code_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- access_codes references children(id) via late-bound FK below
CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  access_code TEXT,
  child_id UUID NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Late-bound FK: access_codes.child_id → children(id) (resolves circular dependency)
DO $$ BEGIN
  ALTER TABLE access_codes ADD CONSTRAINT access_codes_child_id_fkey
    FOREIGN KEY (child_id) REFERENCES children(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== Per-Child Tables ====================

CREATE TABLE IF NOT EXISTS points (
  tenant_id UUID NOT NULL,
  child_id UUID,
  id INTEGER NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS points_history (
  tenant_id UUID NOT NULL,
  child_id UUID,
  id SERIAL,
  date TEXT NOT NULL,
  earned INTEGER NOT NULL DEFAULT 0,
  spent INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS homeworks (
  tenant_id UUID NOT NULL,
  child_id UUID,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS daily_settlement (
  tenant_id UUID NOT NULL,
  child_id UUID,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS efficiency_history (
  tenant_id UUID NOT NULL,
  child_id UUID,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS free_time_tasks (
  tenant_id UUID NOT NULL,
  child_id UUID,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS bounty_submissions (
  tenant_id UUID NOT NULL,
  child_id UUID,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS bounty_completions (
  tenant_id UUID NOT NULL,
  child_id UUID,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS redemptions (
  tenant_id UUID NOT NULL,
  child_id UUID,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS reward_box (
  tenant_id UUID NOT NULL,
  child_id UUID,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS active_buffs (
  tenant_id UUID NOT NULL,
  child_id UUID,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS badges (
  tenant_id UUID NOT NULL,
  child_id UUID,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

-- ==================== Shared Tables (no child_id) ====================

CREATE TABLE IF NOT EXISTS shop_items (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS bounty_tasks (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS email_config (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

-- ==================== Infrastructure Tables ====================

CREATE TABLE IF NOT EXISTS meta (
  tenant_id UUID,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS notifications (
  tenant_id UUID NOT NULL,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS last_modified (
  tenant_id UUID NOT NULL,
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  PRIMARY KEY (tenant_id, table_name, record_key)
);

CREATE TABLE IF NOT EXISTS crdt_operations (
  tenant_id UUID NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  field TEXT,
  value TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

-- ==================== Ops Tables ====================

CREATE TABLE IF NOT EXISTS backup_records (
  id UUID PRIMARY KEY,
  filename TEXT NOT NULL,
  size_bytes BIGINT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_by TEXT NOT NULL DEFAULT 'scheduler'
);

CREATE TABLE IF NOT EXISTS health_records (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL CHECK (event_type IN ('alert_triggered', 'alert_recovered')),
  alert_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning')),
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS alert_state (
  alert_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'alerting')),
  last_notified_at TIMESTAMPTZ,
  first_triggered_at TIMESTAMPTZ,
  severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity IN ('critical', 'warning')),
  message TEXT NOT NULL DEFAULT ''
);

-- ==================== Migration: Multi-Child Support ====================
-- These statements handle existing databases that already have old tables.
-- For fresh installs they are no-ops (IF NOT EXISTS).

-- Step 1: Add child_id columns to per-child tables

-- Step 1.5: Add access_code + last_login to access_codes (missing from pg migration)
DO $$ BEGIN ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS access_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS last_login TIMESTAMP; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
ALTER TABLE points ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE points_history ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE homeworks ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE daily_settlement ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE efficiency_history ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE free_time_tasks ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE bounty_submissions ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE bounty_completions ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE reward_box ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE active_buffs ADD COLUMN IF NOT EXISTS child_id UUID;
ALTER TABLE badges ADD COLUMN IF NOT EXISTS child_id UUID;

-- Step 2: Unique indexes with child_id will be added when adapter is updated

-- Step 3: Make children.access_code_id FK ON DELETE SET NULL
DO $$ BEGIN
  ALTER TABLE children DROP CONSTRAINT IF EXISTS children_access_code_id_fkey;
  ALTER TABLE children ADD CONSTRAINT children_access_code_id_fkey
    FOREIGN KEY (access_code_id) REFERENCES access_codes(id) ON DELETE SET NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Replace old PKs with unique indexes (child_id allowed NULL)
DO $$ BEGIN ALTER TABLE points DROP CONSTRAINT IF EXISTS points_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS points_tenant_child_id_idx ON points (tenant_id, child_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS points_tenant_null_idx ON points (tenant_id, id) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE points_history DROP CONSTRAINT IF EXISTS points_history_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS points_history_tenant_child_id_idx ON points_history (tenant_id, child_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS points_history_tenant_null_idx ON points_history (tenant_id, id) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE homeworks DROP CONSTRAINT IF EXISTS homeworks_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS homeworks_tenant_child_date_idx ON homeworks (tenant_id, child_id, date_key);
CREATE UNIQUE INDEX IF NOT EXISTS homeworks_tenant_null_date_idx ON homeworks (tenant_id, date_key) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE daily_settlement DROP CONSTRAINT IF EXISTS daily_settlement_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS daily_settlement_tenant_child_date_idx ON daily_settlement (tenant_id, child_id, date_key);
CREATE UNIQUE INDEX IF NOT EXISTS daily_settlement_tenant_null_date_idx ON daily_settlement (tenant_id, date_key) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE efficiency_history DROP CONSTRAINT IF EXISTS efficiency_history_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS efficiency_history_tenant_child_date_idx ON efficiency_history (tenant_id, child_id, date_key);
CREATE UNIQUE INDEX IF NOT EXISTS efficiency_history_tenant_null_date_idx ON efficiency_history (tenant_id, date_key) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE free_time_tasks DROP CONSTRAINT IF EXISTS free_time_tasks_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS free_time_tasks_tenant_child_date_idx ON free_time_tasks (tenant_id, child_id, date_key);
CREATE UNIQUE INDEX IF NOT EXISTS free_time_tasks_tenant_null_date_idx ON free_time_tasks (tenant_id, date_key) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE bounty_submissions DROP CONSTRAINT IF EXISTS bounty_submissions_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bounty_submissions_tenant_child_date_idx ON bounty_submissions (tenant_id, child_id, date_key);
CREATE UNIQUE INDEX IF NOT EXISTS bounty_submissions_tenant_null_date_idx ON bounty_submissions (tenant_id, date_key) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE bounty_completions DROP CONSTRAINT IF EXISTS bounty_completions_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bounty_completions_tenant_child_date_idx ON bounty_completions (tenant_id, child_id, date_key);
CREATE UNIQUE INDEX IF NOT EXISTS bounty_completions_tenant_null_date_idx ON bounty_completions (tenant_id, date_key) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE redemptions DROP CONSTRAINT IF EXISTS redemptions_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS redemptions_tenant_child_id_idx ON redemptions (tenant_id, child_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS redemptions_tenant_null_idx ON redemptions (tenant_id, id) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE reward_box DROP CONSTRAINT IF EXISTS reward_box_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS reward_box_tenant_child_id_idx ON reward_box (tenant_id, child_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS reward_box_tenant_null_idx ON reward_box (tenant_id, id) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE active_buffs DROP CONSTRAINT IF EXISTS active_buffs_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS active_buffs_tenant_child_id_idx ON active_buffs (tenant_id, child_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS active_buffs_tenant_null_idx ON active_buffs (tenant_id, id) WHERE child_id IS NULL;

DO $$ BEGIN ALTER TABLE badges DROP CONSTRAINT IF EXISTS badges_pkey; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS badges_tenant_child_id_idx ON badges (tenant_id, child_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS badges_tenant_null_idx ON badges (tenant_id, id) WHERE child_id IS NULL;
