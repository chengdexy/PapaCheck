import { buildApp } from './app.js';
import { parseGatewayEvent, type ScfEvent } from './scf-handler.js';
import type { FastifyInstance } from 'fastify';

/**
 * light-my-request 的 InjectOptions.method 类型（与 fastify HTTPMethods 略有差异，
 * 不含 SEARCH）。SCF 网关只会发送标准 HTTP 方法，此处用字面量联合保证类型兼容。
 */
type InjectMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

let appInstance: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appInstance) {
    appInstance = await buildApp({
      enableAuth: true,
      rateLimit: { max: 100, timeWindow: '1 minute' },
    });
    await appInstance.ready();
  }
  return appInstance;
}

export async function main(event: ScfEvent, context: any): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const app = await getApp();
  const { method, path, headers, query, body } = parseGatewayEvent(event);

  const response = await app.inject({
    method: method.toUpperCase() as InjectMethod,
    url: path,
    headers,
    query,
    payload: body !== null ? JSON.stringify(body) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([k, v]) => [k, String(v)])
    ),
    body: response.payload,
  };
}
