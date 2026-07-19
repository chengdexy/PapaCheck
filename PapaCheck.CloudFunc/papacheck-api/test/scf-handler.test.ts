import { describe, it, expect } from 'vitest';
import { parseGatewayEvent } from '../scf-handler.js';

describe('parseGatewayEvent', () => {
  it('解析 GET 请求', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/ping',
      headers: { 'Content-Type': 'application/json' },
      queryStringParameters: null,
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.method).toBe('GET');
    expect(result.path).toBe('/api/ping');
    expect(result.body).toBeNull();
  });

  it('解析 POST 请求带 JSON body', () => {
    const event = {
      httpMethod: 'POST',
      path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      queryStringParameters: null,
      body: JSON.stringify({ email: 'test@example.com', password: '123' }),
    };
    const result = parseGatewayEvent(event);
    expect(result.method).toBe('POST');
    expect(result.body).toEqual({ email: 'test@example.com', password: '123' });
  });

  it('解析 query 参数', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/homeworks',
      headers: {},
      queryStringParameters: { date: '2026-07-07', child_id: 'abc' },
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.query).toEqual({ date: '2026-07-07', child_id: 'abc' });
  });

  it('headers 键名转小写', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/data',
      headers: { 'Authorization': 'Bearer xxx', 'Content-Type': 'application/json' },
      queryStringParameters: null,
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.headers['authorization']).toBe('Bearer xxx');
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('无 headers 时返回空对象', () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/ping',
      headers: null,
      queryStringParameters: null,
      body: null,
    };
    const result = parseGatewayEvent(event);
    expect(result.headers).toEqual({});
  });
});
