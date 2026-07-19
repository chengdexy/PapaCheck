import { buildApp } from './app.js';
import { parseGatewayEvent } from './scf-handler.js';
import type { FastifyInstance } from 'fastify';

// 真实业务逻辑：构建 Fastify 实例并用 app.inject 处理 SCF 网关事件。
// 单独构建为 handler-body.js，由 index.js 懒加载，确保入口 exports.main 始终先生效。
let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildApp({ enableAuth: true });
  }
  return appPromise;
}

exports.run = async function (event: any, context: any) {
  const req = parseGatewayEvent(event);
  const app = await getApp();

  const res = await app.inject({
    method: req.method,
    url: req.path,
    query: req.query,
    headers: req.headers,
    payload: req.body,
  });

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body,
  };
};
