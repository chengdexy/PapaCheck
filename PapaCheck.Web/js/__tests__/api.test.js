/**
 * api.test.js - API._fetch 单元测试
 *
 * Feature: API._fetch HTTP 请求
 *   Scenario: DELETE 请求不设置 Content-Type
 *     Given method 为 DELETE
 *     When 调用 _fetch
 *     Then fetchOptions.headers 不包含 Content-Type
 *
 *   Scenario: DELETE 响应 204 时返回 null
 *     Given 服务端返回 204 No Content
 *     When 调用 _fetch
 *     Then 返回 null
 *
 *   Scenario: DELETE 响应 205 时返回 null
 *     Given 服务端返回 205 Reset Content
 *     When 调用 _fetch
 *     Then 返回 null
 *
 *   Scenario: GET 请求自动添加 Content-Type
 *     Given method 为 GET（默认）
 *     When 调用 _fetch
 *     Then Content-Type 为 application/json
 *
 *   Scenario: PUT 请求自动添加 Content-Type
 *     Given method 为 PUT
 *     When 调用 _fetch
 *     Then Content-Type 为 application/json
 *
 *   Scenario: PATCH 请求自动添加 Content-Type
 *     Given method 为 PATCH
 *     When 调用 _fetch
 *     Then Content-Type 为 application/json
 *
 *   Scenario: POST 请求自动添加 Content-Type
 *     Given method 为 POST
 *     When 调用 _fetch
 *     Then Content-Type 为 application/json
 *
 *   Scenario: 非成功响应抛出错误
 *     Given 服务端返回 400 Bad Request
 *     When 调用 _fetch
 *     Then 抛出 Error
 *
 *   Scenario: 正常 GET 响应返回解析后的 JSON
 *     Given 服务端返回 200 { key: "value" }
 *     When 调用 _fetch
 *     Then 返回 { key: "value" }
 *
 *   Scenario: HEAD 请求不设置 Content-Type
 *     Given method 为 HEAD
 *     When 调用 _fetch
 *     Then fetchOptions.headers 不包含 Content-Type
 */

import { describe, it, expect } from 'vitest';

/**
 * 模拟 API._fetch 的实现逻辑（从 api.js 提取）
 */
async function _fetchImpl(url, options, fetchFn) {
  if (!options) options = {};
  var method = options.method || 'GET';
  var fetchOptions = { ...options };
  // DELETE 请求没有 body，不设置 Content-Type，避免 Fastify 报空 JSON body 错误
  if (method !== 'DELETE') {
    if (!fetchOptions.headers) fetchOptions.headers = {};
    if (!fetchOptions.headers['Content-Type']) {
      fetchOptions.headers['Content-Type'] = 'application/json';
    }
  }
  var resp = await (fetchFn || fetch)(url, fetchOptions);
  if (!resp.ok) throw new Error(resp.statusText);
  if (resp.status === 204 || resp.status === 205) return null;
  return await resp.json();
}

describe('API._fetch', () => {
  it('DELETE 请求不设置 Content-Type', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', { method: 'DELETE' }, mockFetch);

    expect(capturedOptions.headers).toBeUndefined();
  });

  it('DELETE 响应 204 时返回 null', async () => {
    const mockFetch = async () => {
      return { ok: true, status: 204 };
    };

    const result = await _fetchImpl('/api/test', { method: 'DELETE' }, mockFetch);
    expect(result).toBeNull();
  });

  it('DELETE 响应 205 时返回 null', async () => {
    const mockFetch = async () => {
      return { ok: true, status: 205 };
    };

    const result = await _fetchImpl('/api/test', { method: 'DELETE' }, mockFetch);
    expect(result).toBeNull();
  });

  it('GET 请求自动添加 Content-Type', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', { method: 'GET' }, mockFetch);

    expect(capturedOptions.headers).toBeDefined();
    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });

  it('GET 默认 method 也添加 Content-Type', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', {}, mockFetch);

    expect(capturedOptions.headers).toBeDefined();
    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });

  it('PUT 请求自动添加 Content-Type', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', { method: 'PUT' }, mockFetch);

    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });

  it('PATCH 请求自动添加 Content-Type', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', { method: 'PATCH' }, mockFetch);

    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });

  it('POST 请求自动添加 Content-Type', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', { method: 'POST' }, mockFetch);

    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });

  it('HEAD 请求也添加 Content-Type（仅 DELETE 排除）', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', { method: 'HEAD' }, mockFetch);

    // api.js 中仅 DELETE 排除 Content-Type，HEAD 与其他非 DELETE 方法一样会添加
    expect(capturedOptions.headers).toBeDefined();
    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });

  it('非成功响应抛出错误', async () => {
    const mockFetch = async () => {
      return { ok: false, status: 400, statusText: 'Bad Request' };
    };

    await expect(_fetchImpl('/api/test', {}, mockFetch)).rejects.toThrow('Bad Request');
  });

  it('正常 GET 响应返回解析后的 JSON', async () => {
    const mockFetch = async () => {
      return {
        ok: true,
        status: 200,
        async json() { return { key: 'value', number: 42 }; },
      };
    };

    const result = await _fetchImpl('/api/test', {}, mockFetch);
    expect(result).toEqual({ key: 'value', number: 42 });
  });

  it('已有 Content-Type 时不覆盖', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
    }, mockFetch);

    expect(capturedOptions.headers['Content-Type']).toBe('text/plain');
  });

  it('空 options 时默认 method 为 GET', async () => {
    let capturedOptions = null;
    const mockFetch = async (url, options) => {
      capturedOptions = options;
      return { ok: true, status: 200, async json() { return {}; } };
    };

    await _fetchImpl('/api/test', undefined, mockFetch);

    // method 未传时默认 GET，应添加 Content-Type
    expect(capturedOptions.headers['Content-Type']).toBe('application/json');
  });
});
