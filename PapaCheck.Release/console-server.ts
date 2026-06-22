import Fastify from 'fastify';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { Executor } from './lib/executor.js';
import { buildApk, readApkVersion } from './lib/build-apk.js';
import { cloudPublish } from './lib/cloud-publish.js';
import { sitePublish } from './lib/site-publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'console.html');

export async function startServer(port = 3456) {
  const executor = new Executor();
  const app = Fastify({ logger: false });

  const clients = new Set<(event: string, data: any) => void>();
  const broadcast = (event: string, data: any) => {
    for (const send of clients) send(event, data);
  };

  executor.on('step-start', (e) => broadcast('step-start', e));
  executor.on('step-done', (e) => broadcast('step-done', e));
  executor.on('log', (e) => broadcast('log', e));
  executor.on('release-done', (e) => broadcast('release-done', e));

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(readFileSync(HTML_PATH, 'utf-8'));
  });

  app.get('/api/version', async () => ({ apk: readApkVersion() }));

  app.get('/api/release/history', async () => executor.history);

  app.get('/api/release/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const send = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    clients.add(send);
    request.raw.on('close', () => clients.delete(send));
  });

  app.post('/api/release/build-apk', async (request) => {
    const body = request.body as any || {};
    buildApk(executor, { ver: body.ver, bump: body.bump, noBump: body.noBump }).catch((err) => {
      console.error(err);
    });
    return { ok: true, message: '构建已启动' };
  });

  app.post('/api/release/cloud', async () => {
    cloudPublish(executor).catch((err) => {
      console.error(err);
    });
    return { ok: true, message: '云同步已启动' };
  });

  app.post('/api/release/site', async () => {
    sitePublish(executor).catch((err) => {
      console.error(err);
    });
    return { ok: true, message: 'Site 部署已启动' };
  });

  await app.listen({ port, host: '127.0.0.1' });
  console.log(`\n  PapaCheck Release Console running at http://localhost:${port}\n`);
  return app;
}
