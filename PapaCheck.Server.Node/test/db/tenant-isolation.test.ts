import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const runPg = !!process.env['DATABASE_URL'];

describe.runIf(runPg)('Tenant Isolation', () => {
  let adapter: any;

  beforeAll(async () => {
    const { PostgresAdapter } = await import('../../src/db/postgres-adapter.js');
    adapter = await PostgresAdapter.create(process.env['DATABASE_URL']!);
  });

  afterAll(async () => {
    await adapter?.close();
  });

  // Helper: clean all tenant data for a given tenant_id
  async function cleanTenant(tenantId: string) {
    const tables = [
      'homeworks', 'daily_settlement', 'efficiency_history',
      'free_time_tasks', 'bounty_submissions', 'bounty_completions',
      'shop_items', 'redemptions', 'reward_box', 'settings',
      'active_buffs', 'bounty_tasks', 'badges', 'email_config',
      'points', 'points_history', 'notifications',
      'last_modified', 'crdt_operations',
    ];
    for (const table of tables) {
      await adapter.pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
    // Re-insert default points row
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, id, balance) VALUES ($1, 1, 0) ON CONFLICT DO NOTHING",
      [tenantId]
    );
    // Default single-row entries
    const singleRowDefaults = [
      { table: 'shop_items', data: '[]' },
      { table: 'redemptions', data: '[]' },
      { table: 'badges', data: '[]' },
      { table: 'reward_box', data: '[]' },
      { table: 'settings', data: '{}' },
      { table: 'active_buffs', data: '[]' },
      { table: 'bounty_tasks', data: '[]' },
      { table: 'email_config', data: '{}' },
    ];
    for (const { table, data } of singleRowDefaults) {
      await adapter.pool.query(
        `INSERT INTO ${table} (tenant_id, id, data) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`,
        [tenantId, data]
      );
    }
  }

  it('should have complete data isolation between tenant A and tenant B', async () => {
    const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    // Clean both tenants first
    await cleanTenant(tenantA);
    await cleanTenant(tenantB);

    // ===== Tenant A writes data =====
    // Points
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, id, balance) VALUES ($1, 1, 100) ON CONFLICT (tenant_id, id) DO UPDATE SET balance = 100",
      [tenantA]
    );
    await adapter.pool.query(
      "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, '2026-06-14', 100, 0, 100, 'test')",
      [tenantA]
    );

    // Homeworks
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, '2026-06-14', '[\"hw_A\"]') ON CONFLICT (tenant_id, date_key) DO UPDATE SET data = '[\"hw_A\"]'",
      [tenantA]
    );

    // Shop items
    await adapter.pool.query(
      "UPDATE shop_items SET data = '[\"shop_A\"]' WHERE tenant_id = $1 AND id = 1",
      [tenantA]
    );

    // Settlement
    await adapter.pool.query(
      "INSERT INTO daily_settlement (tenant_id, date_key, data) VALUES ($1, '2026-06-14', '{\"rating\":5}') ON CONFLICT (tenant_id, date_key) DO UPDATE SET data = '{\"rating\":5}'",
      [tenantA]
    );

    // Settings
    await adapter.pool.query(
      "UPDATE settings SET data = '{\"theme\":\"dark\"}' WHERE tenant_id = $1 AND id = 1",
      [tenantA]
    );

    // Notifications
    await adapter.pool.query(
      "INSERT INTO notifications (tenant_id, id, text, created_at) VALUES ($1, 'notif-A', 'A notification', 1234567890) ON CONFLICT (tenant_id, id) DO NOTHING",
      [tenantA]
    );

    // Last modified
    await adapter.pool.query(
      "INSERT INTO last_modified (tenant_id, table_name, record_key, last_modified) VALUES ($1, 'homeworks', '2026-06-14', '2026-06-14T00:00:00Z') ON CONFLICT (tenant_id, table_name, record_key) DO NOTHING",
      [tenantA]
    );

    // CRDT operations
    await adapter.pool.query(
      `INSERT INTO crdt_operations (tenant_id, id, type, table_name, resource_id, value, timestamp, node_id)
       VALUES ($1, 'crdt-A', 'update', 'homeworks', 'hw_A', '{}', '2026-06-14T00:00:00Z', 'node-A') ON CONFLICT (tenant_id, id) DO NOTHING`,
      [tenantA]
    );

    // ===== Tenant B writes different data =====
    await adapter.pool.query(
      "INSERT INTO points (tenant_id, id, balance) VALUES ($1, 1, 200) ON CONFLICT (tenant_id, id) DO UPDATE SET balance = 200",
      [tenantB]
    );
    await adapter.pool.query(
      "INSERT INTO points_history (tenant_id, date, earned, spent, balance, detail) VALUES ($1, '2026-06-14', 200, 0, 200, 'test B')",
      [tenantB]
    );
    await adapter.pool.query(
      "INSERT INTO homeworks (tenant_id, date_key, data) VALUES ($1, '2026-06-14', '[\"hw_B\"]') ON CONFLICT (tenant_id, date_key) DO UPDATE SET data = '[\"hw_B\"]'",
      [tenantB]
    );
    await adapter.pool.query(
      "UPDATE shop_items SET data = '[\"shop_B\"]' WHERE tenant_id = $1 AND id = 1",
      [tenantB]
    );
    await adapter.pool.query(
      "INSERT INTO daily_settlement (tenant_id, date_key, data) VALUES ($1, '2026-06-14', '{\"rating\":3}') ON CONFLICT (tenant_id, date_key) DO UPDATE SET data = '{\"rating\":3}'",
      [tenantB]
    );
    await adapter.pool.query(
      "UPDATE settings SET data = '{\"theme\":\"light\"}' WHERE tenant_id = $1 AND id = 1",
      [tenantB]
    );
    await adapter.pool.query(
      "INSERT INTO notifications (tenant_id, id, text, created_at) VALUES ($1, 'notif-B', 'B notification', 1234567891) ON CONFLICT (tenant_id, id) DO NOTHING",
      [tenantB]
    );
    await adapter.pool.query(
      "INSERT INTO last_modified (tenant_id, table_name, record_key, last_modified) VALUES ($1, 'homeworks', '2026-06-14', '2026-06-14T01:00:00Z') ON CONFLICT (tenant_id, table_name, record_key) DO NOTHING",
      [tenantB]
    );
    await adapter.pool.query(
      `INSERT INTO crdt_operations (tenant_id, id, type, table_name, resource_id, value, timestamp, node_id)
       VALUES ($1, 'crdt-B', 'update', 'homeworks', 'hw_B', '{}', '2026-06-14T01:00:00Z', 'node-B') ON CONFLICT (tenant_id, id) DO NOTHING`,
      [tenantB]
    );

    // ===== Verify Tenant A sees ONLY Tenant A data =====
    const pointsA = await adapter.pool.query(
      "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1", [tenantA]
    );
    expect(pointsA.rows[0].balance).toBe(100);

    const hwA = await adapter.pool.query(
      "SELECT data FROM homeworks WHERE tenant_id = $1 AND date_key = '2026-06-14'", [tenantA]
    );
    expect(JSON.parse(hwA.rows[0].data)).toEqual(['hw_A']);

    const shopA = await adapter.pool.query(
      "SELECT data FROM shop_items WHERE tenant_id = $1 AND id = 1", [tenantA]
    );
    expect(JSON.parse(shopA.rows[0].data)).toEqual(['shop_A']);

    const settlementA = await adapter.pool.query(
      "SELECT data FROM daily_settlement WHERE tenant_id = $1 AND date_key = '2026-06-14'", [tenantA]
    );
    expect(JSON.parse(settlementA.rows[0].data)).toEqual({ rating: 5 });

    const settingsA = await adapter.pool.query(
      "SELECT data FROM settings WHERE tenant_id = $1 AND id = 1", [tenantA]
    );
    expect(JSON.parse(settingsA.rows[0].data)).toEqual({ theme: 'dark' });

    // ===== Verify Tenant A cannot see Tenant B data =====
    // Query without tenant filter - should get A's data (if only A's tenant_id matches)
    // But more importantly, query with B's tenant_id should not return A's data
    const pointsBcheck = await adapter.pool.query(
      "SELECT balance FROM points WHERE tenant_id = $1 AND id = 1", [tenantB]
    );
    expect(pointsBcheck.rows[0].balance).toBe(200);
    // A's data should NOT be mixed with B's
    expect(pointsBcheck.rows[0].balance).not.toBe(100);

    const hwBcheck = await adapter.pool.query(
      "SELECT data FROM homeworks WHERE tenant_id = $1 AND date_key = '2026-06-14'", [tenantB]
    );
    expect(JSON.parse(hwBcheck.rows[0].data)).toEqual(['hw_B']);

    // ===== Verify that full-data queries use getFullData with proper filtering =====
    // Create adapter methods that filter by tenant_id
    // Test that using the public methods (which will later accept tenantId) work correctly
    // For now, verify RAW SQL isolation
    const allHomeworks = await adapter.pool.query("SELECT tenant_id, date_key, data FROM homeworks WHERE date_key = '2026-06-14'");
    expect(allHomeworks.rows.length).toBe(2); // Both tenants have data for this date

    // Verify the data IS separated by tenant_id
    for (const row of allHomeworks.rows) {
      if (row.tenant_id === tenantA) {
        expect(JSON.parse(row.data)).toEqual(['hw_A']);
      } else if (row.tenant_id === tenantB) {
        expect(JSON.parse(row.data)).toEqual(['hw_B']);
      }
    }

    // ===== Verify CRDT operations isolation =====
    const crdtA = await adapter.pool.query(
      "SELECT id FROM crdt_operations WHERE tenant_id = $1", [tenantA]
    );
    expect(crdtA.rows.length).toBe(1);
    expect(crdtA.rows[0].id).toBe('crdt-A');

    const crdtB = await adapter.pool.query(
      "SELECT id FROM crdt_operations WHERE tenant_id = $1", [tenantB]
    );
    expect(crdtB.rows.length).toBe(1);
    expect(crdtB.rows[0].id).toBe('crdt-B');

    // ===== Verify last_modified isolation =====
    const modA = await adapter.pool.query(
      "SELECT record_key FROM last_modified WHERE tenant_id = $1", [tenantA]
    );
    expect(modA.rows.length).toBe(1);
    expect(modA.rows[0].record_key).toBe('2026-06-14');

    const modB = await adapter.pool.query(
      "SELECT record_key FROM last_modified WHERE tenant_id = $1", [tenantB]
    );
    expect(modB.rows.length).toBe(1);
    expect(modB.rows[0].record_key).toBe('2026-06-14');

    // ===== Verify notifications isolation =====
    const notifA = await adapter.pool.query(
      "SELECT id, text FROM notifications WHERE tenant_id = $1", [tenantA]
    );
    expect(notifA.rows.length).toBe(1);
    expect(notifA.rows[0].text).toBe('A notification');

    const notifB = await adapter.pool.query(
      "SELECT id, text FROM notifications WHERE tenant_id = $1", [tenantB]
    );
    expect(notifB.rows.length).toBe(1);
    expect(notifB.rows[0].text).toBe('B notification');
  });

  it('should correctly use adapter methods with tenantId parameter', async () => {
    const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    await cleanTenant(tenantA);
    await cleanTenant(tenantB);

    // Write data using adapter methods with tenantId
    await adapter.saveHomeworks('2026-06-15', [{ id: 'hw1', subject: 'Tenant A HW' }], tenantA);
    await adapter.saveHomeworks('2026-06-15', [{ id: 'hw2', subject: 'Tenant B HW' }], tenantB);

    // Read back with tenantId - each should only see their own data
    const hwA = await adapter.getHomeworks('2026-06-15', tenantA);
    expect(hwA.length).toBe(1);
    expect(hwA[0].subject).toBe('Tenant A HW');

    const hwB = await adapter.getHomeworks('2026-06-15', tenantB);
    expect(hwB.length).toBe(1);
    expect(hwB[0].subject).toBe('Tenant B HW');

    // Test points balance isolation
    await adapter.updatePoints('earn', 50, 'Tenant A points', tenantA);
    await adapter.updatePoints('earn', 100, 'Tenant B points', tenantB);

    const balA = await adapter.getPointsBalance(tenantA);
    const balB = await adapter.getPointsBalance(tenantB);
    expect(balA).toBe(50);
    expect(balB).toBe(100);

    // Test shop items isolation
    await adapter.saveShopItems([{ id: 'item1', name: 'A Item' }], tenantA);
    await adapter.saveShopItems([{ id: 'item2', name: 'B Item' }], tenantB);

    const shopA = await adapter.getShopItems(tenantA);
    const shopB = await adapter.getShopItems(tenantB);
    expect(shopA.length).toBe(1);
    expect(shopA[0].name).toBe('A Item');
    expect(shopB.length).toBe(1);
    expect(shopB[0].name).toBe('B Item');

    // Test settings isolation
    await adapter.saveSettings({ theme: 'dark' }, tenantA);
    await adapter.saveSettings({ theme: 'light' }, tenantB);

    const settingsA = await adapter.getSettings(tenantA);
    const settingsB = await adapter.getSettings(tenantB);
    expect(settingsA.theme).toBe('dark');
    expect(settingsB.theme).toBe('light');
  });

  it('should isolate getFullData and getModifiedSince between tenants', async () => {
    const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    await cleanTenant(tenantA);
    await cleanTenant(tenantB);

    // Populate tenant A
    await adapter.saveHomeworks('2026-06-16', [{ id: 'hwA1', subject: 'Math' }], tenantA);
    await adapter.updatePoints('earn', 10, 'daily', tenantA);
    await adapter.saveShopItems([{ id: 'sA1', name: 'Toy' }], tenantA);

    // Populate tenant B
    await adapter.saveHomeworks('2026-06-16', [{ id: 'hwB1', subject: 'English' }], tenantB);
    await adapter.updatePoints('earn', 20, 'daily', tenantB);
    await adapter.saveShopItems([{ id: 'sB1', name: 'Game' }], tenantB);

    // getFullData with tenantId
    const fullA = await adapter.getFullData(tenantA);
    const fullB = await adapter.getFullData(tenantB);

    expect(fullA.points.balance).toBe(10);
    expect(fullB.points.balance).toBe(20);
    expect(fullA.homeworks['2026-06-16']?.[0]?.subject).toBe('Math');
    expect(fullB.homeworks['2026-06-16']?.[0]?.subject).toBe('English');
    expect(fullA.shopItems[0]?.name).toBe('Toy');
    expect(fullB.shopItems[0]?.name).toBe('Game');

    // getModifiedSince with tenantId
    const modA = await adapter.getModifiedSince('2000-01-01', tenantA);
    const modB = await adapter.getModifiedSince('2000-01-01', tenantB);

    expect(modA.length).toBeGreaterThan(0);
    expect(modB.length).toBeGreaterThan(0);
  });
});
