import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// @cloudbase/node-sdk 的 utils/version.js 在模块加载时同步执行
// loadPackage() = readFileSync(path.join(__dirname, '../../package.json'))。
// esbuild bundle 后 __dirname 统一为 SCF 工作目录（/var/user），'../../package.json'
// 解析到不存在的 '/package.json'，导致整个 node-sdk 模块加载抛 ENOENT。
// 该 version 仅用于 HTTP 请求头 User-Agent / X-SDK-Version，无功能影响，
// 因此用 onLoad 把 version.js 替换为硬编码版本，彻底绕过运行时文件读取。
const tcbVersionShim = {
  name: 'tcb-version-shim',
  setup(build) {
    build.onLoad(
      { filter: /@cloudbase[\\/]node-sdk[\\/]dist[\\/]utils[\\/]version\.js$/ },
      async () => ({
        contents: '"use strict"; Object.defineProperty(exports, "__esModule", { value: true }); exports.version = "3.1.0";',
        loader: 'js',
      }),
    );
  },
};

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  plugins: [tcbVersionShim],
  // 在 CJS 输出中 polyfill import.meta.url（module.filename 为 CJS 原生）
  banner: {
    js: 'const __import_meta_url = require("url").pathToFileURL(module.filename).href;',
  },
  define: {
    'import.meta.url': '__import_meta_url',
  },
  // 自包含打包：将运行时依赖打进 bundle，避免依赖云端 npm install。
  // 仅保留 pg 的原生/可选依赖为 external（不存在时 pg 自身以 try/catch 降级）。
  external: [
    'pg-native',
    'pg-cloudflare',
  ],
  packages: 'bundle',
};

// 产物 1：真实业务逻辑（Fastify 构建 + 网关事件处理）
// 单独打包，且不与 index.js 合并，使 index.js 能懒加载它，保证入口 exports.main 始终先生效。
await build({
  ...common,
  entryPoints: ['handler-body.ts'],
  outfile: 'dist/handler-body.js',
});

// 产物 2：轻量入口 wrapper
// 仅做 exports.main 直接赋值 + try/catch，懒加载 ./handler-body.js。
// ./handler-body.js 标记为 external，运行时作为同一目录下的独立文件 require，
// 因此 handler-body 的模块初始化不会发生在 index.js 加载期（不会让 exports.main 失效）。
await build({
  ...common,
  entryPoints: ['index.ts'],
  outfile: 'dist/index.js',
  external: [
    ...common.external,
    './handler-body.js',
  ],
});

// 生成 dist/package.json（不带 type:module）
const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
);
const distPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: rootPkg.description,
  main: 'index.js',
  dependencies: rootPkg.dependencies,
};
mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
writeFileSync(
  resolve(__dirname, 'dist/package.json'),
  JSON.stringify(distPkg, null, 2) + '\n',
);

// 随部署包写入稳定 JWT 密钥文件（云端 /var/user 只读但可读）。
// 密钥必须来自构建期环境变量 JWT_SECRET，严禁硬编码回退（泄露事件后整改）。
// 非生产环境缺失时回退到随机密钥（仅本地开发：重启后旧 token 失效，无生产风险）；
// 生产环境缺失则直接报错，避免用硬编码密钥部署上线。
let jwtSecret = process.env['JWT_SECRET'];
if (!jwtSecret) {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'JWT_SECRET 环境变量未设置，无法生成 dist/jwt.secret。生产环境禁止回退到硬编码密钥，请在构建环境中注入 JWT_SECRET。',
    );
  }
  jwtSecret = randomBytes(32).toString('hex');
}
writeFileSync(resolve(__dirname, 'dist/jwt.secret'), jwtSecret, 'utf-8');

console.log('✓ Build complete: dist/index.js (wrapper) + dist/handler-body.js (logic)');
console.log('✓ Generated: dist/package.json + dist/jwt.secret');
