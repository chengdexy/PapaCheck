import { buildApp } from './app.js';
import { parseGatewayEvent } from './scf-handler.js';
import type { FastifyInstance } from 'fastify';
import { setCloudBaseApp } from './cloudbase-ctx.js';
import cloudbase from '@cloudbase/node-sdk';

// 初始化 CloudBase SDK 实例（模块级单例），供路由使用（如调用 tts-svc 云函数）。
// 等价于旧 index.ts 在模块级执行的 cloudbase.init({}) + setCloudBaseApp。
try {
  const tcbApp = cloudbase.init({});
  setCloudBaseApp(tcbApp);
} catch (err) {
  console.warn('[SCF] Failed to init CloudBase SDK:', err);
}

// light-my-request 的 InjectOptions.method 类型（与 fastify HTTPMethods 略有差异，不含 SEARCH）。
type InjectMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

// 真实业务逻辑：构建 Fastify 实例并用 app.inject 处理 SCF 网关事件。
// 单独构建为 handler-body.js，由 index.js 懒加载，确保入口 exports.main 始终先生效。
let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = await buildApp({ enableAuth: true });
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

exports.run = async function (event: any, context: any) {
  const req = parseGatewayEvent(event);
  const app = await getApp();

  const res = await app.inject({
    method: req.method.toUpperCase() as InjectMethod,
    url: req.path,
    headers: req.headers,
    query: req.query,
    payload:
      req.body !== null
        ? typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body)
        : undefined,
  });

  // 检测是否为二进制响应（如 TTS 音频），按 SCF 网关要求 base64 编码并标记 isBase64Encoded
  const contentType = (res.headers['content-type'] as string) || '';
  const isBinary =
    contentType.startsWith('audio/') ||
    contentType.startsWith('image/') ||
    contentType.startsWith('video/');

  return {
    statusCode: res.statusCode,
    headers: Object.fromEntries(
      Object.entries(res.headers).map(([k, v]) => [k, String(v)])
    ),
    body: isBinary ? res.rawPayload.toString('base64') : res.payload,
    ...(isBinary ? { isBase64Encoded: true } : {}),
  };
};
