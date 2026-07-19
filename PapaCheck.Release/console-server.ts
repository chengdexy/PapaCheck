import Fastify from 'fastify';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { Executor, type StepDef } from './lib/executor.js';
import { buildApk, readApkVersion } from './lib/build-apk.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
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
    buildApk(executor, { ver: body.ver, bump: body.bump, noBump: body.noBump, publish: body.publish, publishOnBuild: body.publishOnBuild }).catch((err) => {
      console.error(err);
    });
    return { ok: true, message: '构建已启动' };
  });

  app.post('/api/release/fn', async () => {
    const steps: StepDef[] = [
      { id: '1', desc: '编译云函数', cmd: 'npm run build', cwd: join(ROOT, 'PapaCheck.CloudFunc', 'papacheck-api'), shell: true, timeout: 120 },
      { id: '2', desc: '部署云函数', cmd: `tcb fn deploy papacheck-api --env-id ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.CloudFunc', 'papacheck-api'), shell: true, timeout: 120 },
    ];
    executor.runAndReport('云函数部署', steps).catch((err) => console.error(err));
    return { ok: true, message: '云函数部署已启动' };
  });

  app.post('/api/release/site', async () => {
    const steps: StepDef[] = [
      { id: '1', desc: '构建站点', cmd: 'npm run build', cwd: join(ROOT, 'PapaCheck.Site'), shell: true, timeout: 120 },
      { id: '2', desc: '部署到 CloudBase', cmd: `tcb hosting deploy dist/ papacheck --env-id ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.Site'), shell: true, timeout: 120 },
    ];
    executor.runAndReport('Site 部署', steps).catch((err) => console.error(err));
    return { ok: true, message: 'Site 部署已启动' };
  });

  app.post('/api/release/web', async () => {
    const steps: StepDef[] = [
      { id: '1', desc: '清空远端旧文件', cmd: `tcb hosting delete papacheck/app --dir --env-id ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.Web'), shell: true, timeout: 30 },
      { id: '2', desc: '部署 Web 前端到 CloudBase', cmd: `deploy.bat ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.Web'), shell: true, timeout: 120 },
    ];
    executor.runAndReport('Web 部署', steps).catch((err) => console.error(err));
    return { ok: true, message: 'Web 部署已启动' };
  });

  app.post('/api/release/all', async () => {
    (async () => {
      const fnOk = await executor.runAndReport('云函数部署', [
        { id: '1', desc: '编译云函数', cmd: 'npm run build', cwd: join(ROOT, 'PapaCheck.CloudFunc', 'papacheck-api'), shell: true, timeout: 120 },
        { id: '2', desc: '部署云函数', cmd: `tcb fn deploy papacheck-api --env-id ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.CloudFunc', 'papacheck-api'), shell: true, timeout: 120 },
      ]);
      if (!fnOk) return;
      const siteOk = await executor.runAndReport('Site 部署', [
        { id: '1', desc: '构建站点', cmd: 'npm run build', cwd: join(ROOT, 'PapaCheck.Site'), shell: true, timeout: 120 },
        { id: '2', desc: '部署到 CloudBase', cmd: `tcb hosting deploy dist/ papacheck --env-id ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.Site'), shell: true, timeout: 120 },
      ]);
      if (!siteOk) return;
      await executor.runAndReport('Web 部署', [
          { id: '1', desc: '清空远端旧文件', cmd: `tcb hosting delete papacheck/app --dir --env-id ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.Web'), shell: true, timeout: 30 },
          { id: '2', desc: '部署 Web 前端到 CloudBase', cmd: `deploy.bat ${CLOUDBASE_ENV}`, cwd: join(ROOT, 'PapaCheck.Web'), shell: true, timeout: 120 },
        ]);
    })().catch((err) => console.error(err));
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
