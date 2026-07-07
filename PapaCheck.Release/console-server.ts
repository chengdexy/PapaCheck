import Fastify from 'fastify';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { Executor } from './lib/executor.js';
import { buildApk, readApkVersion } from './lib/build-apk.js';
import { deployCloudFunction } from './lib/cloud-publish.js';
import { publishSite, publishWebApp } from './lib/site-publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'console.html');
const LOG_DIR = join(__dirname, 'log');
const CLOUDBASE_ENV = 'child-teacher-parent-d9aef9d2208';

export async function startServer(port = 3456) {
  const executor = new Executor();
  const app = Fastify({ logger: false });

  const clients = new Set<(event: string, data: any) => void>();
  const broadcast = (event: string, data: any) => {
    for (const send of clients) {
      try {
        send(event, data);
      } catch {
        clients.delete(send);
      }
    }
  };

  executor.on('step-start', (e) => broadcast('step-start', e));
  executor.on('step-done', (e) => broadcast('step-done', e));
  executor.on('log', (e) => broadcast('log', e));
  executor.on('release-done', (e) => broadcast('release-done', e));

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(readFileSync(HTML_PATH, 'utf-8'));
  });

  app.get('/api/version', async () => ({ apk: readApkVersion() }));

  app.get('/api/release/env', async () => ({
    CLOUDBASE_ENV_ID: CLOUDBASE_ENV,
  }));

  app.get('/api/release/history', async () => executor.history);

  app.get('/api/release/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const send = (event: string, data: any) => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clients.delete(send);
      }
    };
    clients.add(send);
    request.raw.on('close', () => clients.delete(send));
  });

  app.post('/api/release/build-apk', async (request) => {
    const body = request.body as any || {};
    buildApk(executor, { ver: body.ver, bump: body.bump, noBump: body.noBump, publish: body.publish }).catch((err) => {
      console.error(err);
    });
    return { ok: true, message: '构建已启动' };
  });

  app.post('/api/release/fn', async () => {
    deployCloudFunction().catch((err) => console.error(err));
    return { ok: true, message: '云函数部署已启动' };
  });

  app.post('/api/release/site', async () => {
    publishSite().catch((err) => console.error(err));
    return { ok: true, message: 'Site 部署已启动' };
  });

  app.post('/api/release/web', async () => {
    publishWebApp().catch((err) => console.error(err));
    return { ok: true, message: 'Web 部署已启动' };
  });

  app.post('/api/release/all', async () => {
    deployCloudFunction()
      .then(() => publishSite())
      .then(() => publishWebApp())
      .catch((err) => console.error(err));
    return { ok: true, message: '全部部署已启动' };
  });

  app.post('/api/release/save-log', async (request) => {
    const body = request.body as any || {};
    const type = body.type || 'unknown';
    const content = body.content || '';
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    mkdirSync(LOG_DIR, { recursive: true });
    const filePath = join(LOG_DIR, `release-${type}-${ts}.txt`);
    writeFileSync(filePath, content, 'utf-8');
    return { ok: true, path: filePath };
  });

  await app.listen({ port, host: '127.0.0.1' });
  console.log(`\n  PapaCheck Release Console running at http://localhost:${port}\n`);
  return app;
}
