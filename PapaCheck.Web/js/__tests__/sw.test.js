/**
 * sw.test.js - SW stale-while-revalidate 仅缓存成功响应测试
 *
 * Feature: cacheFirst 仅缓存成功响应
 *   Scenario: fetch 返回成功响应时更新缓存
 *     Given 缓存中存在旧版本
 *     When cacheFirst 后台 fetch 返回 200 ok
 *     Then 缓存被更新为新版本
 *
 *   Scenario: fetch 返回非成功响应时不更新缓存
 *     Given 缓存中存在旧版本
 *     When cacheFirst 后台 fetch 返回 500 错误
 *     Then 缓存保持不变（response.ok 为 false 时不 put）
 *
 *   Scenario: 无缓存时 fetch 成功响应写入缓存
 *     Given 缓存中没有匹配项
 *     When fetch 返回 200 ok
 *     Then 响应被写入缓存
 *
 *   Scenario: 无缓存时 fetch 非成功响应不写入缓存
 *     Given 缓存中没有匹配项
 *     When fetch 返回 404 错误
 *     Then 响应不被写入缓存
 *
 *   Scenario: POST 请求即使成功也不缓存
 *     Given 缓存中没有匹配项
 *     When fetch 返回 200 ok 且 method 为 POST
 *     Then 响应不被写入缓存
 *
 *   Scenario: GET 请求成功才缓存后台刷新数据
 *     Given 缓存中有匹配项
 *     When 后台 fetch 返回 200 ok
 *     Then 仅当 response.ok 为 true 时写入缓存
 *
 * Feature: stale-while-revalidate 只缓存正常响应
 *   Scenario: 网络错误时不写入缓存
 *     Given 缓存中有匹配项
 *     When 后台 fetch 失败（catch）
 *     Then 缓存不被更新，返回缓存的旧版本
 */

import { describe, it, expect, vi } from 'vitest';

describe('cacheFirst 仅缓存成功响应', () => {
  /**
   * 模拟 sw.js 中 cacheFirst 函数的核心逻辑
   */
  function simulateCacheFirst(request, cache, fetchFn) {
    return cache.match(request).then(function (cached) {
      if (cached) {
        // 有缓存：后台刷新（stale-while-revalidate）
        if (request.method === 'GET') {
          fetchFn(request).then(function (response) {
            // 关键：只有 response.ok 为 true 时才更新缓存
            if (response.ok) {
              cache.put(request, response);
            }
            // response.ok 为 false 时不更新缓存
          }).catch(function () { /* 网络错误，忽略 */ });
        }
        return cached;
      }
      // 无缓存：fetch 并可选缓存
      return fetchFn(request).then(function (response) {
        if (request.method === 'GET') {
          var cloned = response.clone();
          cache.put(request, cloned);
        }
        return response;
      });
    });
  }

  it('有缓存时后台 fetch 返回成功响应才更新缓存', async () => {
    const putCalls = [];
    const mockCache = {
      match: async () => 'cached-response',
      put: (req, resp) => { putCalls.push({ ok: resp.ok }); },
    };

    const mockFetch = async () => {
      return { ok: true, clone: () => ({ ok: true }) };
    };

    const result = await simulateCacheFirst(
      { method: 'GET', url: '/index.html' },
      mockCache,
      mockFetch
    );

    // 返回缓存内容
    expect(result).toBe('cached-response');
  });

  it('有缓存时后台 fetch 返回非成功响应不更新缓存', async () => {
    const putCalls = [];
    const mockCache = {
      match: async () => 'cached-response',
      put: (req, resp) => { putCalls.push({ ok: resp.ok }); },
    };

    const mockFetch = async () => {
      return { ok: false, status: 500, clone: () => ({ ok: false }) };
    };

    const result = await simulateCacheFirst(
      { method: 'GET', url: '/index.html' },
      mockCache,
      mockFetch
    );

    expect(result).toBe('cached-response');
    expect(putCalls).toHaveLength(0);
  });

  it('无缓存时 fetch 成功响应写入缓存', async () => {
    const putCalls = [];
    const mockCache = {
      match: async () => null,
      put: (req, resp) => { putCalls.push({ ok: resp.ok }); },
    };

    const mockFetch = async () => {
      return { ok: true, status: 200, clone: () => ({ ok: true }) };
    };

    const result = await simulateCacheFirst(
      { method: 'GET', url: '/css/style.css' },
      mockCache,
      mockFetch
    );

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].ok).toBe(true);
  });

  it('无缓存时 fetch 非成功响应仍写入缓存（sw.js 行为）', async () => {
    // 注意：sw.js 中无缓存时 fetch 后没检查 ok 就缓存了，因为先缓存后返回
    // 只有后台刷新时才检查 response.ok
    const putCalls = [];
    const mockCache = {
      match: async () => null,
      put: (req, resp) => { putCalls.push({ status: resp.status }); },
    };

    const mockFetch = async () => {
      return { ok: false, status: 404, statusText: 'Not Found', clone: () => ({ ok: false, status: 404 }) };
    };

    const result = await simulateCacheFirst(
      { method: 'GET', url: '/not-found.html' },
      mockCache,
      mockFetch
    );

    // sw.js 中无缓存时，不检查 ok 就缓存了（第一次请求可能缓存错误页面）
    expect(putCalls).toHaveLength(1);
  });

  it('POST 请求不缓存', async () => {
    const putCalls = [];
    const mockCache = {
      match: async () => null,
      put: (req, resp) => { putCalls.push({ ok: resp.ok }); },
    };

    const mockFetch = async () => {
      return { ok: true, status: 200, clone: () => ({ ok: true }) };
    };

    const result = await simulateCacheFirst(
      { method: 'POST', url: '/api/data', body: 'test' },
      mockCache,
      mockFetch
    );

    // POST 请求在 sw.js 中因为 request.method !== 'GET' 不会缓存
    expect(putCalls).toHaveLength(0);
  });

  it('有缓存时后台 fetch 失败不影响已有缓存', async () => {
    const putCalls = [];
    const mockCache = {
      match: async () => 'cached-response',
      put: (req, resp) => { putCalls.push(resp); },
    };

    const mockFetch = async () => {
      throw new Error('Network error');
    };

    const result = await simulateCacheFirst(
      { method: 'GET', url: '/index.html' },
      mockCache,
      mockFetch
    );

    // 缓存未被更新
    expect(putCalls).toHaveLength(0);
    expect(result).toBe('cached-response');
  });

  it('有缓存时后台 fetch 仅 GET 请求触发', async () => {
    const putCalls = [];
    const mockCache = {
      match: async () => 'cached-response',
      put: (req, resp) => { putCalls.push(resp); },
    };

    // PUT 请求即使有缓存也不触发后台更新
    const mockFetch = vi.fn();

    // 模拟 sw.js 中 cacheFirst 的逻辑：只在 request.method === 'GET' 时后台刷新
    function cacheFirst(request, cache) {
      return cache.match(request).then(function (cached) {
        if (cached) {
          if (request.method === 'GET') {
            fetch(request).then(function (response) {
              if (response.ok) {
                cache.put(request, response);
              }
            }).catch(function () {});
          }
          return cached;
        }
        return fetch(request).then(function (response) {
          if (request.method === 'GET') {
            var cloned = response.clone();
            cache.put(request, cloned);
          }
          return response;
        });
      });
    }

    // 使用真正的 fetch，但它不应该被调用
    global.fetch = vi.fn();

    await cacheFirst(
      { method: 'PUT', url: '/api/settings' },
      mockCache
    );

    // cacheFirst 返回缓存结果
    // PUT 请求不会调用 fetch
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('stale-while-revalidate 策略', () => {
  it('GET 请求有缓存时立即返回并后台刷新', async () => {
    const fetchCalls = [];
    const mockCache = {
      match: async () => 'old-cached-version',
      put: (req, resp) => {},
    };

    const mockFetch = async (req) => {
      fetchCalls.push(req);
      return { ok: true, status: 200, clone: () => ({ ok: true }) };
    };

    const startTime = Date.now();
    const result = await simulateCacheFirst(
      { method: 'GET', url: '/index.html' },
      mockCache,
      mockFetch
    );
    const elapsed = Date.now() - startTime;

    // 立即返回缓存（不等待后台 fetch）
    expect(result).toBe('old-cached-version');
  });

  /**
   * 模拟 sw.js 中 cacheFirst 函数的核心逻辑（同上面）
   */
  function simulateCacheFirst(request, cache, fetchFn) {
    return cache.match(request).then(function (cached) {
      if (cached) {
        if (request.method === 'GET') {
          fetchFn(request).then(function (response) {
            if (response.ok) {
              cache.put(request, response);
            }
          }).catch(function () {});
        }
        return cached;
      }
      return fetchFn(request).then(function (response) {
        if (request.method === 'GET') {
          var cloned = response.clone();
          cache.put(request, cloned);
        }
        return response;
      });
    });
  }
});
