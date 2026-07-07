import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/cloudbase.js', () => ({
  initCloudBase: vi.fn(),
  signInWithJwt: vi.fn().mockResolvedValue(true),
  getDb: vi.fn(() => ({
    table: vi.fn(() => ({
      where: vi.fn(() => ({
        watch: vi.fn((callback) => {
          return () => { /* unsubscribe */ };
        }),
      })),
    })),
  })),
  getCurrentTenantId: vi.fn(() => 'tenant-1'),
  getCurrentChildId: vi.fn(() => 'child-1'),
}));

import { RealtimeManager } from '../js/realtime.js';

describe('RealtimeManager', () => {
  let realtime;

  beforeEach(() => {
    realtime = new RealtimeManager();
  });

  it('start 后建立 14 张表订阅', async () => {
    const subscribeSpy = vi.spyOn(realtime, 'subscribe');
    await realtime.start('fake-token', 'tenant-1', 'child-1');
    expect(subscribeSpy).toHaveBeenCalledTimes(14);
  });

  it('stop 取消所有订阅', async () => {
    await realtime.start('fake-token', 'tenant-1', 'child-1');
    expect(realtime.subscriptions.size).toBe(14);
    realtime.stop();
    expect(realtime.subscriptions.size).toBe(0);
  });

  it('onHomeworksChange 回调可被调用', () => {
    const change = { new: { id: 1, name: '作业1' }, old: null };
    expect(() => realtime.onHomeworksChange(change)).not.toThrow();
  });
});
