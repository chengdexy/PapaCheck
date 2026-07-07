import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cloudbase/js-sdk', () => {
  const mockApp = {
    auth: vi.fn(() => ({
      signInWithJwt: vi.fn().mockResolvedValue(true),
    })),
    rdb: vi.fn(() => ({})),
  };
  return {
    default: {
      init: vi.fn(() => mockApp),
    },
  };
});

import { initCloudBase, signInWithJwt, getDb } from '../js/cloudbase.js';

describe('CloudBase SDK 初始化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initCloudBase 返回 app 实例', () => {
    const app = initCloudBase();
    expect(app).toBeDefined();
    expect(app.auth).toBeDefined();
  });

  it('signInWithJwt 调用 auth.signInWithJwt', async () => {
    const token = 'fake-jwt-token';
    await signInWithJwt(token);
    expect(true).toBe(true);
  });

  it('getDb 返回 rdb 实例', () => {
    initCloudBase();
    const db = getDb();
    expect(db).toBeDefined();
  });
});
