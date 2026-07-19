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
  // 已成功初始化则跳过；失败不锁定，允许后续请求重试，
  // 避免首次冷启动环境变量未就绪/临时故障导致「永久 502 CloudBase SDK not initialized」。
  if (_cloudBaseReady) return;
  const envFromProcess = process.env.TCB_ENV || '';
  const envFromContext = (context && context.environ && context.environ.TCB_ENV) || '';
  const env = envFromProcess || envFromContext || '';
  console.log('[cloudbase] ensureCloudBaseApp: envFromProcess=', JSON.stringify(envFromProcess), 'envFromContext=', JSON.stringify(envFromContext));
  if (!env) {
    console.error('[cloudbase] TCB_ENV 未设置（process.env 与 context.environ 均未取到），CloudBase SDK 暂不初始化，TTS 功能暂不可用');
    return; // 不锁定，下个请求重试
  }
  try {
    const app = tcb.init({ env });
    setCloudBaseApp(app);
    _cloudBaseReady = true;
    console.log('[cloudbase] SDK 初始化成功，env=', env);
  } catch (e: any) {
    console.error('[cloudbase] SDK 初始化失败:', e && e.message ? e.message : e);
    _cloudBaseReady = false; // 允许重试
  }
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

// 判断 Content-Type 是否为文本类（JSON / text / xml / html 等）。
// 非文本类（audio/* image/* application/octet-stream 等）需走 base64 + isBase64Encoded，
// 否则 SCF 网关会把二进制当 UTF-8 string 传输，导致字节损坏、body 丢失、
// 浏览器报 ERR_CONTENT_LENGTH_MISMATCH（如 /api/speak 的 MP3 音频）。
function isTextContentType(contentType: string | undefined): boolean {
  if (!contentType) return true; // 缺省按文本处理
  const ct = contentType.toLowerCase();
  if (ct.startsWith('text/')) return true;
  if (ct.includes('json')) return true;
  if (ct.includes('xml')) return true;
  if (ct.includes('javascript')) return true;
  if (ct.includes('html')) return true;
  if (ct.includes('form-urlencoded')) return true;
  return false;
}

exports.run = async function (event: any, context: any) {
  ensureCloudBaseApp(context);
  const req = parseGatewayEvent(event);
  const app = await getApp();

  // responseType: 'buffer' 不被 light-my-request 支持，res.body 默认是 UTF-8 string
  // 会损坏二进制响应（如 MP3）。改用 res.rawPayload 拿原始 Buffer。
  const res = await app.inject({
    method: req.method,
    url: req.path,
    query: req.query,
    headers: req.headers,
    payload: req.body,
  });

  const contentType = (res.headers as Record<string, string>)['content-type'];
  const isText = isTextContentType(contentType);
  const bodyBuf = res.rawPayload as Buffer; // 始终是原始字节 Buffer

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    // 文本响应：UTF-8 string；二进制响应：base64 编码 + isBase64Encoded 让网关解码回二进制。
    body: isText ? bodyBuf.toString('utf-8') : bodyBuf.toString('base64'),
    isBase64Encoded: !isText,
  };
};
