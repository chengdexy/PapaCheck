import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import minimist from 'minimist';
import { buildApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = minimist(process.argv.slice(2), {
  string: ['port', 'web-dir', 'db-path', 'tts-python'],
  default: {
    port: '8080',
    'web-dir': resolve(__dirname, '..', '..', 'PapaCheck.Web'),
    'db-path': resolve(__dirname, '..', 'data.db'),
    'tts-python': 'python',
  },
});

const port = parseInt(args.port, 10);
const webDir = resolve(process.cwd(), args['web-dir']);
const dbPath = resolve(process.cwd(), args['db-path']);
const ttsPython = args['tts-python'];

async function main(): Promise<void> {
  const app = await buildApp({
    port,
    webDir,
    dbPath,
    ttsPython,
  });

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
