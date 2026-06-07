import { spawn, type SpawnOptions } from 'child_process';
import type { Readable } from 'stream';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// __dirname polyfill：兼容 ESM（tsx）和 CJS（pkg/SEA）
const _moduleFilename = typeof __filename !== 'undefined'
  ? __filename
  : fileURLToPath(import.meta.url);
const _moduleDirname = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(_moduleFilename);

/** 可被 mock 的 spawn 函数签名 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => {
  stdout: Readable;
  stderr: Readable;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
  kill(signal?: string): void;
};

export interface TTSBridgeOptions {
  /** Python 可执行文件路径，默认 'python' */
  pythonPath?: string;
  /** TTS 桥接脚本路径，默认自动检测（SEA 资源 → 环境变量 → 文件系统） */
  scriptPath?: string;
  /** 磁盘缓存目录 */
  cacheDir?: string;
  /** 内部：测试用 spawn 注入 */
  _spawn?: SpawnFn;
}

/** 注册进程退出时清理临时文件的回调 */
function registerCleanup(tmpPath: string): void {
  const cleanup = () => {
    try { unlinkSync(tmpPath); } catch { /* 文件可能已被删除 */ }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

/**
 * 解析 TTS 桥接脚本的路径，按优先级：
 * 1. 显式传入的 scriptPath
 * 2. 环境变量 PAPACHECK_TTS_SCRIPT
 * 3. SEA 内置资源（process.getBuiltinAsset），写入临时目录
 * 4. 文件系统路径：
 *    a. dist/scripts/tts_bridge.py（pkg/SEA 打包后）
 *    b. scripts/tts_bridge.py（开发模式，相对项目根目录）
 */
function resolveScriptPath(explicit?: string): string {
  // 1. 显式传入
  if (explicit) return explicit;

  // 2. 环境变量
  const envPath = process.env.PAPACHECK_TTS_SCRIPT;
  if (envPath) return envPath;

  // 3. SEA 内置资源（仅 Node.js SEA 运行时）
  const p = process as any;
  if (typeof p.getBuiltinAsset === 'function') {
    try {
      const asset = p.getBuiltinAsset('ttsBridge') as { data: Buffer } | undefined;
      if (asset?.data && asset.data.length > 0) {
        const tmpPath = join(tmpdir(), `papacheck-tts-bridge-${Date.now()}.py`);
        writeFileSync(tmpPath, asset.data);
        registerCleanup(tmpPath);
        return tmpPath;
      }
    } catch {
      // SEA 资源不可用，继续降级
    }
  }

  // 4. pkg 环境：脚本在快照虚拟文件系统中，子进程无法访问，需提取到临时目录
  if ((process as any).pkg) {
    const snapshotPath = join(_moduleDirname, 'scripts', 'tts_bridge.py');
    try {
      const content = readFileSync(snapshotPath);
      const tmpPath = join(tmpdir(), `papacheck-tts-bridge-${Date.now()}.py`);
      writeFileSync(tmpPath, content);
      registerCleanup(tmpPath);
      return tmpPath;
    } catch {
      // 快照中读取失败，降级到临时目录硬编码
    }
  }

  // 5. 开发模式：scripts/tts_bridge.py（_moduleDirname = src/tts/）
  return join(_moduleDirname, '..', '..', 'scripts', 'tts_bridge.py');
}

export class TTSBridge {
  private cache: Map<string, Buffer> = new Map();
  private pythonPath: string;
  private scriptPath: string;
  private cacheDir: string;
  private spawnFn: SpawnFn;
  /** 上次 TTS 失败的错误信息（供 API 端点读取） */
  _lastError: string = '';

  constructor(options: TTSBridgeOptions = {}) {
    this.pythonPath = options.pythonPath ?? 'python';
    this.scriptPath = resolveScriptPath(options.scriptPath);
    this.cacheDir = options.cacheDir ?? join(_moduleDirname, '..', '..', 'tts_cache');
    this.spawnFn = options._spawn ?? spawn as unknown as SpawnFn;
  }

  /** 计算文本的 MD5 哈希作为缓存 key */
  private md5(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }

  /** 获取内存缓存中的语音数据 */
  getCached(text: string): Buffer | undefined {
    return this.cache.get(text);
  }

  /** 生成语音，返回 MP3 Buffer */
  async speak(text: string): Promise<Buffer> {
    // 1. 检查内存缓存
    const cached = this.cache.get(text);
    if (cached) return cached;

    const hash = this.md5(text);
    const cachePath = join(this.cacheDir, `${hash}.mp3`);

    // 2. 检查磁盘缓存
    try {
      const diskData = await readFile(cachePath);
      this.cache.set(text, diskData);
      return diskData;
    } catch {
      // 磁盘缓存未命中
    }

    // 3. 确保缓存目录存在
    await mkdir(this.cacheDir, { recursive: true }).catch(() => { });

    // 4. 生成语音
    const mp3Data = await this.spawnPython(text);

    // 5. 缓存结果
    if (mp3Data.length > 0) {
      this.cache.set(text, mp3Data);
      writeFile(cachePath, mp3Data).catch(() => { });
    }

    return mp3Data;
  }

  /** 启动 Python 子进程生成语音 */
  private spawnPython(text: string): Promise<Buffer> {
    return new Promise((resolve) => {
      console.log(`[TTS] spawning: ${this.pythonPath} ${this.scriptPath} text="${text.slice(0, 30)}..."`);
      const proc = this.spawnFn(this.pythonPath, [this.scriptPath, text], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          console.error(`[TTS] timeout (30s) for text: "${text.slice(0, 30)}..."`);
          resolve(Buffer.alloc(0));
        }
      }, 30000);

      const finish = (result: Buffer) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        }
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        errChunks.push(chunk);
      });

      proc.on('error', (err) => {
        console.error('[TTS] process error:', err.message);
        finish(Buffer.alloc(0));
      });

      proc.on('close', (code) => {
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim();
        if (code === 0) {
          if (stderr) console.log('[TTS] stderr:', stderr);
          finish(Buffer.concat(chunks));
        } else {
          console.error(`[TTS] exit code=${code} stderr="${stderr}"`);
          finish(Buffer.alloc(0));
        }
      });
    });
  }

  /** 后台预生成一批语音 */
  pregenSpeech(texts: string[]): void {
    for (const text of texts) {
      if (text && text.trim()) {
        this.speak(text).catch(() => { });
      }
    }
  }
}
