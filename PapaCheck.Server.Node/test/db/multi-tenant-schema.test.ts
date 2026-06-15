import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const SCHEMA_PATH = new URL('../../scripts/init-pg-schema.sql', import.meta.url);

describe('Multi-tenant Schema', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');

  it('should define tenants table with all columns', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS tenants');
    expect(schema).toContain('id UUID PRIMARY KEY');
    expect(schema).toContain('admin_id UUID');
    expect(schema).toContain('created_at TIMESTAMP DEFAULT NOW()');
  });

  it('should define users table with access_hash and token_version', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(schema).toContain('access_hash TEXT NOT NULL');
    expect(schema).toContain('token_version INTEGER NOT NULL DEFAULT 1');
    expect(schema).toContain('is_super_admin BOOLEAN DEFAULT false');
    expect(schema).toContain('needs_password_change BOOLEAN DEFAULT true');
    expect(schema).toContain('UNIQUE(tenant_id, nickname)');
  });

  it('should add tenant_id to all date-key tables', () => {
    const dateKeyTables = ['homeworks', 'daily_settlement', 'efficiency_history', 'free_time_tasks', 'bounty_submissions', 'bounty_completions'];
    for (const table of dateKeyTables) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(schema).toContain('tenant_id UUID NOT NULL');
      expect(schema).toContain('PRIMARY KEY (tenant_id, date_key)');
    }
  });

  it('should add tenant_id to all single-row tables', () => {
    const singleRowTables = ['shop_items', 'redemptions', 'reward_box', 'settings', 'active_buffs', 'bounty_tasks', 'badges', 'email_config'];
    for (const table of singleRowTables) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(schema).toContain('tenant_id UUID NOT NULL');
      expect(schema).toContain('PRIMARY KEY (tenant_id, id)');
    }
  });

  it('should add tenant_id to points table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS points');
    expect(schema).toContain('tenant_id UUID NOT NULL');
    expect(schema).toContain('PRIMARY KEY (tenant_id, id)');
  });

  it('should add tenant_id to points_history table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS points_history');
    expect(schema).toContain('tenant_id UUID NOT NULL');
  });

  it('should add tenant_id to notifications table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS notifications');
    expect(schema).toContain('tenant_id UUID NOT NULL');
  });

  it('should add tenant_id to last_modified table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS last_modified');
    expect(schema).toContain('tenant_id UUID NOT NULL');
    expect(schema).toContain('PRIMARY KEY (tenant_id, table_name, record_key)');
  });

  it('should add tenant_id to crdt_operations table', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS crdt_operations');
    expect(schema).toContain('tenant_id UUID NOT NULL');
  });

  it('meta table should have tenant_id id', () => {
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS meta');
    expect(schema).toContain('tenant_id UUID');
    expect(schema).toContain('PRIMARY KEY (tenant_id, key)');
  });
});
