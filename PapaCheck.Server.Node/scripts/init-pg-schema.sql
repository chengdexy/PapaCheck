-- PostgreSQL Schema for PapaCheck (Multi-Tenant)

-- ==================== Multi-Tenant Tables ====================

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_name TEXT,
  admin_id UUID,  -- 可空：管理员注册时填写，迁移时无管理员
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

CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('parent', 'child')),
  code_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, nickname)
);

-- ==================== Business Tables ====================

CREATE TABLE IF NOT EXISTS points (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS points_history (
  tenant_id UUID NOT NULL,
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
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS daily_settlement (
  tenant_id UUID NOT NULL,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS shop_items (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS redemptions (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS efficiency_history (
  tenant_id UUID NOT NULL,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS free_time_tasks (
  tenant_id UUID NOT NULL,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS meta (
  tenant_id UUID,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS badges (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS reward_box (
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

CREATE TABLE IF NOT EXISTS active_buffs (
  tenant_id UUID NOT NULL,
  id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS bounty_submissions (
  tenant_id UUID NOT NULL,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, date_key)
);

CREATE TABLE IF NOT EXISTS bounty_completions (
  tenant_id UUID NOT NULL,
  date_key TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, date_key)
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
