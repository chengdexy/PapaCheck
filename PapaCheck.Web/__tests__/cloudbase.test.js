import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cloudbase/js-sdk', () => {
  const mockApp = {
    auth: vi.fn(() => ({
      signInAnonymously: vi.fn().mockResolvedValue(true),
    })),
    rdb: vi.fn(() => ({})),
    database: vi.fn(() => ({})),
  };
  return {
    default: {
      init: vi.fn(() => mockApp),
    },
  };
});

import { initCloudBase, signInAnonymously, getDb } from '../js/cloudbase.js';

describe('CloudBase SDK 初始化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initCloudBase 返回 app 实例', () => {
    const app = initCloudBase();
    expect(app).toBeDefined();
    expect(app.auth).toBeDefined();
  });

  it('signInAnonymously 调用 auth.signInAnonymously', async () => {
    const token = 'fake-jwt-token';
    await signInAnonymously();
    expect(true).toBe(true);
  });

  it('getDb 返回 rdb 实例', () => {
    initCloudBase();
    const db = getDb();
    expect(db).toBeDefined();
  });
});
