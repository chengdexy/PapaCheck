import { buildApp } from './app.js';
import { parseGatewayEvent } from './scf-handler.js';
import { setCloudBaseApp } from './cloudbase-ctx.js';
import * as tcb from '@cloudbase/node-sdk';
import type { FastifyInstance } from 'fastify';

// 初始化 CloudBase SDK（用于 callFunction 调用 tts-svc 等云函数）。
// envId 优先从 SCF context / 环境变量 TCB_ENV 读取，避免写死到代码。
// 注意：pregen-speech / speak 路由依赖 getCloudBaseApp()，必须在首请求前完成初始化，
// 否则会命中 app.ts 中的 `if (!tcbApp) return 502` 分支。
let _cloudBaseReady = false;
function ensureCloudBaseApp(context: any): void {
  if (_cloudBaseReady) return;
  const env =
    (context && context.environ && context.environ.TCB_ENV) ||
    process.env.TCB_ENV ||
    '';
  if (env) {
    try {
      const app = tcb.init({ env });
      setCloudBaseApp(app);
    } catch (e: any) {
      console.error('[cloudbase] SDK 初始化失败:', e?.message);
    }
  } else {
    console.error('[cloudbase] TCB_ENV 未设置，CloudBase SDK 未初始化，TTS 相关功能暂不可用');
  }
  _cloudBaseReady = true;
}

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
  ensureCloudBaseApp(context);
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
