import { resolve } from 'path';
import minimist from 'minimist';
import { buildApp } from './app.js';

const args = minimist(process.argv.slice(2), {
  string: ['port', 'web-dir', 'db-path', 'tts-python'],
  default: {
    port: '8080',
    'web-dir': resolve(process.cwd(), '..', 'PapaCheck.Web'),
    'db-path': resolve(process.cwd(), 'data.db'),
    'tts-python': 'python',
  },
});

const port = parseInt(args.port, 10);
const webDir = resolve(process.cwd(), args['web-dir']);
const dbPath = resolve(process.cwd(), args['db-path']);
const ttsPython = args['tts-python'];

let shuttingDown = false;
const gracefulShutdown = (app: Awaited<ReturnType<typeof buildApp>>, signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Server] 收到 ' + signal + '，正在优雅关闭...');
  app.close()
    .then(async () => {
      try {
        await (app as any).papaCheckDB.close();
      } catch {
        // 数据库关闭失败不影响进程退出
      }
      console.log('[Server] 服务器已关闭');
      process.exit(0);
    })
    .catch((err: Error) => {
      console.error('[Server] 关闭出错:', err);
      process.exit(1);
    });
};

async function main(): Promise<void> {
  const app = await buildApp({
    port,
    webDir,
    dbPath,
    ttsPython,
    enableAuth: true,
  });

  // 替换已有的 SIGTERM/SIGINT 处理器（TTS bridge 有自注册的 process.exit(0) 处理器）
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.on('SIGTERM', () => gracefulShutdown(app, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(app, 'SIGINT'));

  await app.listen({ port, host: '0.0.0.0' });

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     PapaCheck（爸~检查！）Server            ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Port:        ${String(port).padEnd(30)}║`);
  console.log(`║  Web Dir:     ${String(webDir).padEnd(30)}║`);
  console.log(`║  DB Path:     ${String(dbPath).padEnd(30)}║`);
  console.log(`║  TTS Python:  ${String(ttsPython).padEnd(30)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  API:  http://localhost:' + String(port).padEnd(22) + '║');
  console.log('║  Docs: http://localhost:' + String(port) + '/docs        ║');
  console.log('╚══════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
