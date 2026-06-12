-- PostgreSQL Schema for PapaCheck
-- 与 PostgresAdapter._initSchema 完全等价

CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  balance INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS points_history (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  earned INTEGER NOT NULL DEFAULT 0,
  spent INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS homeworks (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS daily_settlement (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS efficiency_history (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS free_time_tasks (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS reward_box (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS active_buffs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS bounty_tasks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS email_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS bounty_submissions (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS bounty_completions (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS last_modified (
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  PRIMARY KEY (table_name, record_key)
);

CREATE TABLE IF NOT EXISTS crdt_operations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  field TEXT,
  value TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 默认数据
INSERT INTO points (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING;
INSERT INTO shop_items (id, data) VALUES (1, '[]') ON CONFLICT DO NOTHING;
INSERT INTO redemptions (id, data) VALUES (1, '[]') ON CONFLICT DO NOTHING;
INSERT INTO badges (id, data) VALUES (1, '[]') ON CONFLICT DO NOTHING;
INSERT INTO reward_box (id, data) VALUES (1, '[]') ON CONFLICT DO NOTHING;
INSERT INTO settings (id, data) VALUES (1, '{}') ON CONFLICT DO NOTHING;
INSERT INTO active_buffs (id, data) VALUES (1, '[]') ON CONFLICT DO NOTHING;
INSERT INTO bounty_tasks (id, data) VALUES (1, '[]') ON CONFLICT DO NOTHING;
INSERT INTO email_config (id, data) VALUES (1, '{}') ON CONFLICT DO NOTHING;
