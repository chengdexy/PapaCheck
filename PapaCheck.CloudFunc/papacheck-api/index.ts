import { buildApp } from './app.js';
import { parseGatewayEvent, type ScfEvent } from './scf-handler.js';
import type { FastifyInstance } from 'fastify';
import { setCloudBaseApp } from './cloudbase-ctx.js';
import cloudbase from '@cloudbase/node-sdk';

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
  isBase64Encoded?: boolean;
}> {
  // 初始化 CloudBase SDK 实例，供路由使用（如调用 tts-svc 云函数）
  try {
    const tcbApp = cloudbase.init({});
    setCloudBaseApp(tcbApp);
  } catch (err) {
    console.warn('[SCF] Failed to init CloudBase SDK:', err);
  }

  const app = await getApp();
  const { method, path, headers, query, body } = parseGatewayEvent(event);

  const response = await app.inject({
    method: method.toUpperCase() as InjectMethod,
    url: path,
    headers,
    query,
    payload: body !== null ? JSON.stringify(body) : undefined,
  });

  // 检测是否为二进制响应（如 TTS 音频）
  const contentType = (response.headers['content-type'] as string) || '';
  const isBinary = contentType.startsWith('audio/') || contentType.startsWith('image/') || contentType.startsWith('video/');

  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([k, v]) => [k, String(v)])
    ),
    body: isBinary
      ? response.rawPayload.toString('base64')
      : response.payload,
    ...(isBinary ? { isBase64Encoded: true } : {}),
  };
}
