import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.sessionStorage = {
  getItem: vi.fn(() => 'fake-token'),
  setItem: vi.fn(),
};

describe('api.js 无轮询版本', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'test' }),
    });
  });

  it('API_BASE 为 /papacheck/api', async () => {
    const API = await import('../js/api.js');
    expect(API.API_BASE).toBe('/papacheck/api');
  });

  it('getData 调用 /papacheck/api/data', async () => {
    const API = await import('../js/api.js');
    await API.getData();
    expect(mockFetch).toHaveBeenCalledWith(
      '/papacheck/api/data',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('无 pollServer 函数', async () => {
    const API = await import('../js/api.js');
    expect(API.pollServer).toBeUndefined();
  });

  it('无 _requestWithStrategy 函数', async () => {
    const API = await import('../js/api.js');
    expect(API._requestWithStrategy).toBeUndefined();
  });
});
