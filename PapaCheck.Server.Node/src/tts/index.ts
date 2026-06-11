import { spawn, type SpawnOptions } from 'child_process';
import type { Writable } from 'stream';
import type { Readable } from 'stream';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// __dirname polyfill：兼容 ESM（tsx）和 CJS（pkg/SEA）
const _moduleFilename = typeof __filename !== 'undefined'
  ? __filename
  : fileURLToPath(import.meta.url);
export const _moduleDirname = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(_moduleFilename);

/** 可被 mock 的 spawn 函数签名 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => {
  stdin: Writable;
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
  /** 启动时预生成的固定短语列表 */
  static readonly FIXED_TEXTS: string[] = [
    '已申请延后，等待审核',
    '任务已暂停',
    '任务已继续',
    '还剩5分钟',
    '还剩1分钟',
    '已超时，请尽快完成',
    '全部作业已完成，等待评级',
    '屏幕已唤醒',
    '已提交',
    '已提交申请，等待确认',
    '兑换成功！',
    '奖励箱有新奖励，快去看看吧',
    '在学校提前完成，好样的！',
    '收到云端作业，请查看',
    '收到新作业，请查看',
    '作业被驳回，请查看',
    '积分商店上新啦',
    '今天作业获得的评价是……优！',
    '今天作业获得的评价是……良！',
    '今天作业获得的评价是……可！',
    '今天作业获得的评价是……差！',
    ...Array.from({ length: 24 }, (_, h) => `现在是${h}点`),
  ];

  private cache: Map<string, Buffer> = new Map();
  private pythonPath: string;
  private scriptPath: string;
  private cacheDir: string;
  private spawnFn: SpawnFn;
  /** 上次 TTS 失败的错误信息（供 API 端点读取） */
  _lastError: string = '';
  /** 获取上一次 TTS 失败的错误信息 */
  getLastError(): string {
    return this._lastError;
  }
  /** 常驻子进程引用 */
  private _daemonProc: any = null;
  /** daemon 通信串行锁（Promise 链，同一时间只允许一个请求通过 stdin/stdout） */
  private _daemonLock: Promise<void>;

  constructor(options: TTSBridgeOptions = {}) {
    this._daemonLock = Promise.resolve();
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

    // 4. 生成语音（直接 spawn 一次性 Python 进程，SEA 环境下 stdin pipe 不可用）
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
        proc.stdout.removeAllListeners('data');
        proc.stderr.removeAllListeners('data');
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim();
        if (code === 0) {
          if (stderr) console.log('[TTS] stderr:', stderr);
          finish(Buffer.concat(chunks));
        } else {
          // 只取 stderr 最后一行（实际错误信息），省略 Python 完整堆栈
          const lines = stderr.split('\n').filter(l => l.trim());
          const errMsg = lines.length > 0 ? lines[lines.length - 1] : stderr;
          console.error(`[TTS] exit code=${code} ${errMsg}`);
          finish(Buffer.alloc(0));
        }
      });
    });
  }

  /** 确保常驻进程已启动（懒加载） */
  private _ensureDaemon(): void {
    if (this._daemonProc) return;
    const proc = this.spawnFn(this.pythonPath, [this.scriptPath, '--daemon'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[TTS] daemon: ${line}`);
      }
    });
    proc.on('error', (err) => {
      console.error('[TTS] daemon 启动失败:', err.message);
      this._daemonProc = null;
    });
    proc.on('close', () => {
      this._daemonProc = null;
    });
    // 防止 stdin 在 daemon 退出后 emit 'error' 事件导致 Node.js 崩溃
    proc.stdin.on('error', () => { });
    this._daemonProc = proc;
    console.log('[TTS] daemon 启动完成');
  }

  /** 通过常驻进程合成语音，失败时退化到 spawnPython */
  private async _talkToDaemon(text: string): Promise<Buffer> {
    this._ensureDaemon();
    const proc = this._daemonProc;
    if (!proc) return this.spawnPython(text);

    // 串行化：同一时间只允许一个请求通过 stdin/stdout
    return new Promise((resolve, reject) => {
      this._daemonLock = this._daemonLock.then(() => new Promise<void>((innerResolve) => {
        const timeout = setTimeout(() => {
          proc.removeListener('close', onClose);
          proc.kill();
          this._daemonProc = null;
          console.error(`[TTS] daemon timeout (30s) for text: "${text.slice(0, 30)}..."`);
          innerResolve();
          resolve(this.spawnPython(text));
        }, 30000);

        // 读取 4 字节长度前缀
        let headerBuf = Buffer.alloc(0);
        const onHeader = (chunk: Buffer) => {
          headerBuf = Buffer.concat([headerBuf, chunk]);
          if (headerBuf.length >= 4) {
            proc.stdout.removeListener('data', onHeader);
            const len = headerBuf.readUInt32LE(0);
            if (len === 0) {
              clearTimeout(timeout);
              proc.removeListener('close', onClose);
              innerResolve();
              resolve(Buffer.alloc(0));
              return;
            }
            // 读取 MP3 数据
            let dataBuf = Buffer.alloc(0);
            const onData = (chunk: Buffer) => {
              dataBuf = Buffer.concat([dataBuf, chunk]);
              if (dataBuf.length >= len) {
                proc.stdout.removeListener('data', onData);
                clearTimeout(timeout);
                proc.removeListener('close', onClose);
                innerResolve();
                resolve(dataBuf.subarray(0, len));
              }
            };
            proc.stdout.on('data', onData);
          }
        };
        proc.stdout.on('data', onHeader);
        // daemon 进程退出时立即退化，不等 30s 超时
        const onClose = () => {
          clearTimeout(timeout);
          proc.stdout.removeListener('data', onHeader);
          this._daemonProc = null;
          innerResolve();
          resolve(this.spawnPython(text));
        };
        proc.on('close', onClose);

        // 写入请求
        try {
          proc.stdin.write(text + '\n');
        } catch (e) {
          clearTimeout(timeout);
          proc.stdout.removeListener('data', onHeader);
          proc.removeListener('close', onClose);
          this._daemonProc = null;
          innerResolve();
          resolve(this.spawnPython(text));
        }
      }));
    });
  }

  /** 启动时预生成所有固定短语并清理陈旧缓存 */
  async pregenAllFixed(): Promise<void> {
    if (TTSBridge.FIXED_TEXTS.length === 0) return;

    const validHashes = new Set(TTSBridge.FIXED_TEXTS.map(t => this.md5(t) + '.mp3'));

    console.log('[TTS] 开始预生成TTS固定短语mp3...');
    await Promise.allSettled(TTSBridge.FIXED_TEXTS.map(t => this.speak(t)));

    // 清理不在列表中的旧 mp3
    try {
      const files = await readdir(this.cacheDir);
      const stale = files.filter(f => f.endsWith('.mp3') && !validHashes.has(f));
      await Promise.allSettled(stale.map(f => unlink(join(this.cacheDir, f))));
    } catch { /* cacheDir 可能还不存在 */ }

    console.log(`[TTS] 预生成TTS固定短语${TTSBridge.FIXED_TEXTS.length}条完成`);
  }

  /** 后台预生成一批语音 */
  pregenSpeech(texts?: string[]): void {
    const target = texts ?? TTSBridge.FIXED_TEXTS;
    for (const text of target) {
      if (text && text.trim()) {
        this.speak(text).catch(() => { });
      }
    }
  }

  /** 停止常驻进程，释放资源 */
  stop(): void {
    if (this._daemonProc) {
      try {
        this._daemonProc.kill();
      } catch { /* 进程可能已退出 */ }
      this._daemonProc = null;
    }
  }
}
