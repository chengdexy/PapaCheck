// Feature: TTS 语音服务
//   Scenario: Python 子进程桥接
//     Given TTS Bridge 已初始化
//     When 调用 speak('你好')
//     Then 返回 MP3 Buffer
//
//   Scenario: 常驻进程模式
//     Given TTS Bridge 已初始化
//     When _ensureDaemon 被首次调用
//     Then 以 --daemon 参数 spawn Python 子进程
//
//   Scenario: 常驻进程合成语音
//     Given TTS Bridge 已初始化且常驻进程已启动
//     When _talkToDaemon('你好') 被调用
//     Then 通过 stdin 发送文本，从 stdout 读取长度前缀的 MP3 数据
//
//   Scenario: 常驻进程退化
//     Given 常驻进程超时或写入失败
//     When _talkToDaemon 被调用
//     Then 自动退化到 spawnPython

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { TTSBridge, type SpawnFn } from '../src/tts/index.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;
  proc.stdout.setEncoding = vi.fn();
  proc.stderr.setEncoding = vi.fn();
  proc.kill = vi.fn();
  return proc;
}

/** 创建可用于模拟常驻进程的 mock 子进程（含双工 stdin/stdout） */
function createMockDaemonProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;
  proc.stdin = new EventEmitter() as any;
  proc.stdin.write = vi.fn();
  proc.kill = vi.fn();
  return proc;
}

describe('TTSBridge', () => {
  let bridge: TTSBridge;
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('speak', () => {
    // Test 1: Cache hit returns cached buffer
    it('内存缓存命中时直接返回缓存的 Buffer', async () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const mp3Data = Buffer.from('fake-mp3-data');
      // Manually set internal cache
      (bridge as any).cache.set('你好', mp3Data);

      const result = await bridge.speak('你好');

      expect(result).toBe(mp3Data);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    // Test 2: Cache miss spawns subprocess
    it('缓存未命中时通过 spawn 子进程生成语音', async () => {
      const mp3Data = Buffer.from('fake-mp3-data');
      const proc = createMockProcess();

      mockSpawn.mockReturnValue(proc);
      (mkdir as any).mockResolvedValue(undefined);
      (readFile as any).mockRejectedValue(new Error('not found'));
      (writeFile as any).mockResolvedValue(undefined);

      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      // Use nextTick to let the async speak() reach spawnPython() first
      await new Promise(process.nextTick);
      // Simulate successful subprocess
      proc.stdout.emit('data', mp3Data);
      proc.emit('close', 0);

      const result = await promise;

      expect(mockSpawn).toHaveBeenCalledWith('python', ['/fake/tts_bridge.py', '你好'], expect.any(Object));
      expect(result).toEqual(mp3Data);
      // Should be cached
      expect((bridge as any).cache.get('你好')).toEqual(mp3Data);
      // Should be written to disk
      expect(writeFile).toHaveBeenCalled();
    });

    // Test 3: Error handling when subprocess fails
    it('子进程失败时返回空 Buffer', async () => {
      const proc = createMockProcess();

      mockSpawn.mockReturnValue(proc);
      (mkdir as any).mockResolvedValue(undefined);
      (readFile as any).mockRejectedValue(new Error('not found'));

      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      // Use nextTick to let the async speak() reach spawnPython() first
      await new Promise(process.nextTick);
      // Simulate non-zero exit
      proc.emit('close', 1);

      const result = await promise;

      expect(result).toEqual(Buffer.alloc(0));
      expect(writeFile).not.toHaveBeenCalled();
    });

    // Test 4: Timeout handling
    it('超过 30 秒超时时返回空 Buffer', async () => {
      vi.useFakeTimers();
      const proc = createMockProcess();

      mockSpawn.mockReturnValue(proc);
      (mkdir as any).mockResolvedValue(undefined);
      (readFile as any).mockRejectedValue(new Error('not found'));

      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      // Advance time past the 30s timeout
      await vi.advanceTimersByTimeAsync(30000);

      const result = await promise;

      expect(proc.kill).toHaveBeenCalled();
      expect(result).toEqual(Buffer.alloc(0));
    });

    // Test 5: spawn error event returns empty buffer
    it('spawn 触发 error 事件时返回空 Buffer', async () => {
      const proc = createMockProcess();

      mockSpawn.mockReturnValue(proc);
      (mkdir as any).mockResolvedValue(undefined);
      (readFile as any).mockRejectedValue(new Error('not found'));

      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      // Simulate spawn error - use a callback to avoid unhandled error
      process.nextTick(() => {
        proc.emit('error', new Error('python not found'));
      });

      const result = await promise;

      expect(result).toEqual(Buffer.alloc(0));
    });
  });

  describe('getCached', () => {
    it('未缓存时返回 undefined', () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      expect(bridge.getCached('你好')).toBeUndefined();
    });

    it('缓存命中时返回 Buffer', () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const mp3Data = Buffer.from('cached-data');
      (bridge as any).cache.set('你好', mp3Data);
      expect(bridge.getCached('你好')).toEqual(mp3Data);
    });
  });

  describe('pregenSpeech', () => {
    it('后台预生成语音，对每个文本调用 speak', async () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const speakSpy = vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.alloc(0));

      bridge.pregenSpeech(['你好', '世界']);

      expect(speakSpy).toHaveBeenCalledTimes(2);
      expect(speakSpy).toHaveBeenCalledWith('你好');
      expect(speakSpy).toHaveBeenCalledWith('世界');
    });

    it('过滤空文本', () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const speakSpy = vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.alloc(0));

      bridge.pregenSpeech(['你好', '', '   ', '世界']);

      expect(speakSpy).toHaveBeenCalledTimes(2);
      expect(speakSpy).toHaveBeenCalledWith('你好');
      expect(speakSpy).toHaveBeenCalledWith('世界');
    });

    it('无参调用时默认使用 FIXED_TEXTS', () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const speakSpy = vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.alloc(0));

      bridge.pregenSpeech();

      expect(speakSpy).toHaveBeenCalledTimes(45);
      expect(speakSpy).toHaveBeenCalledWith(TTSBridge.FIXED_TEXTS[0]);
    });
  });

  describe('FIXED_TEXTS', () => {
    it('包含 45 条固定短语', () => {
      expect(TTSBridge.FIXED_TEXTS.length).toBe(45);
    });

    it('包含 24 条整点报时', () => {
      const hourTexts = TTSBridge.FIXED_TEXTS.filter(t => t.startsWith('现在是'));
      expect(hourTexts.length).toBe(24);
      expect(hourTexts[0]).toBe('现在是0点');
      expect(hourTexts[23]).toBe('现在是23点');
    });

    it('所有文本非空', () => {
      expect(TTSBridge.FIXED_TEXTS.every(t => t.trim().length > 0)).toBe(true);
    });
  });

  describe('pregenAllFixed', () => {
    it('对所有固定短语调用 speak', async () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const speakSpy = vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.alloc(0));

      await bridge.pregenAllFixed();

      expect(speakSpy).toHaveBeenCalledTimes(45);
      // 验证第一个和最后一个调用
      expect(speakSpy).toHaveBeenCalledWith('已申请延后，等待审核');
      expect(speakSpy).toHaveBeenCalledWith('现在是23点');
    });

    it('控制台输出开始/完成日志', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.alloc(0));

      await bridge.pregenAllFixed();

      expect(consoleSpy).toHaveBeenNthCalledWith(1, '[TTS] 开始预生成TTS固定短语mp3...');
      expect(consoleSpy).toHaveBeenLastCalledWith('[TTS] 预生成TTS固定短语45条完成');
    });

    it('清理陈旧缓存文件', async () => {
      (readdir as any).mockResolvedValue(['abc123.mp3', 'stale.mp3']);
      (unlink as any).mockResolvedValue(undefined);
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      // 模拟所有的 speak 调用都成功
      vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.from('data'));

      await bridge.pregenAllFixed();

      // stale.mp3 不在 FIXED_TEXTS 中，应该被删除
      expect(unlink).toHaveBeenCalledWith(expect.stringMatching(/stale\.mp3$/));
    });

    it('不删除属于固定短语的缓存文件', async () => {
      // 生成一个属于 FIXED_TEXTS 中第一条短语的 hash 文件
      const crypto = await import('crypto');
      const firstHash = crypto.createHash('md5').update(TTSBridge.FIXED_TEXTS[0]).digest('hex') + '.mp3';
      (readdir as any).mockResolvedValue([firstHash]);

      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.from('data'));

      await bridge.pregenAllFixed();

      // 有效的缓存文件不应该被删除
      expect(unlink).not.toHaveBeenCalledWith(expect.stringMatching(new RegExp(firstHash.replace(/\./g, '\\.'))));
    });
  });

  describe('磁盘缓存', () => {
    it('磁盘缓存存在时读取并缓存到内存', async () => {
      const mp3Data = Buffer.from('disk-cached-data');
      (readFile as any).mockResolvedValue(mp3Data);

      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const result = await bridge.speak('你好');

      expect(result).toEqual(mp3Data);
      expect((bridge as any).cache.get('你好')).toEqual(mp3Data);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('生成后写入磁盘缓存', async () => {
      const mp3Data = Buffer.from('new-mp3-data');
      const proc = createMockProcess();

      mockSpawn.mockReturnValue(proc);
      (mkdir as any).mockResolvedValue(undefined);
      (readFile as any).mockRejectedValue(new Error('not found'));
      (writeFile as any).mockResolvedValue(undefined);

      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      // Use nextTick to let the async speak() reach spawnPython() first
      await new Promise(process.nextTick);
      proc.stdout.emit('data', mp3Data);
      proc.emit('close', 0);

      await promise;

      expect(writeFile).toHaveBeenCalled();
      // writeFile should be called with cacheDir + md5 hash + '.mp3'
      const writeCall = (writeFile as any).mock.calls[0];
      expect(writeCall[0]).toMatch(/[a-f0-9]{32}\.mp3$/);
    });
  });

  describe('getLastError', () => {
    it('_lastError 为空字符串时返回空字符串', () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      expect(bridge.getLastError()).toBe('');
    });

    it('_lastError 有值时返回对应错误信息', () => {
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      (bridge as any)._lastError = 'python not found';
      expect(bridge.getLastError()).toBe('python not found');
    });
  });

  describe('pregenAllFixed - 空 FIXED_TEXTS', () => {
    it('FIXED_TEXTS 为空时提前返回，不调用 speak', async () => {
      const original = (TTSBridge as any).FIXED_TEXTS;
      (TTSBridge as any).FIXED_TEXTS = [];
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });
      const speakSpy = vi.spyOn(bridge, 'speak').mockResolvedValue(Buffer.alloc(0));

      await bridge.pregenAllFixed();

      expect(speakSpy).not.toHaveBeenCalled();
      (TTSBridge as any).FIXED_TEXTS = original;
    });
  });

  describe('daemon 常驻进程', () => {
    let daemonProc: any;

    beforeEach(() => {
      daemonProc = createMockDaemonProcess();
    });

    // ----- _ensureDaemon -----

    it('_ensureDaemon 延迟启动常驻进程（--daemon 参数）', () => {
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      // 初始时 _daemonProc 为 null/undefined
      expect((bridge as any)._daemonProc).toBeNull();

      (bridge as any)._ensureDaemon();

      expect(mockSpawn).toHaveBeenCalledWith(
        'python',
        ['/fake/tts_bridge.py', '--daemon'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect((bridge as any)._daemonProc).toBe(daemonProc);
    });

    it('_ensureDaemon spawn 触发 error 时将 _daemonProc 置为 null', () => {
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      (bridge as any)._ensureDaemon();
      expect((bridge as any)._daemonProc).toBe(daemonProc);

      daemonProc.emit('error', new Error('python not found'));

      expect((bridge as any)._daemonProc).toBeNull();
    });

    it('_ensureDaemon 多次调用只启动一个进程', () => {
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      (bridge as any)._ensureDaemon();
      (bridge as any)._ensureDaemon();
      (bridge as any)._ensureDaemon();

      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('常驻进程 close 时 _daemonProc 被置为 null', () => {
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      (bridge as any)._ensureDaemon();
      expect((bridge as any)._daemonProc).toBe(daemonProc);

      daemonProc.emit('close');

      expect((bridge as any)._daemonProc).toBeNull();
    });

    it('常驻进程的 stderr 被打印到控制台', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      (bridge as any)._ensureDaemon();

      daemonProc.stderr.emit('data', Buffer.from('line1\nline2\n'));

      expect(consoleSpy).toHaveBeenCalledWith('[TTS] daemon: line1');
      expect(consoleSpy).toHaveBeenCalledWith('[TTS] daemon: line2');
      consoleSpy.mockRestore();
    });

    // ----- _talkToDaemon -----

    it('_talkToDaemon 通过常驻进程合成语音', async () => {
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      const mp3Data = Buffer.from('daemon-mp3-output');
      const promise = (bridge as any)._talkToDaemon('你好');

      // 等待 _daemonLock 链注册好 stdout 监听器
      await new Promise(resolve => setImmediate(resolve));

      // daemon 返回长度前缀的响应
      const header = Buffer.alloc(4);
      header.writeUInt32LE(mp3Data.length, 0);
      daemonProc.stdout.emit('data', header);
      daemonProc.stdout.emit('data', mp3Data);

      const result = await promise;
      expect(result).toEqual(mp3Data);
      expect(daemonProc.stdin.write).toHaveBeenCalledWith('你好\n');
    });

    it('_talkToDaemon 处理空文本返回空 Buffer', async () => {
      mockSpawn.mockReturnValue(daemonProc);
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const promise = (bridge as any)._talkToDaemon('');

      // 等待 _daemonLock 链注册好 stdout 监听器
      await new Promise(resolve => setImmediate(resolve));

      // daemon 返回长度为 0 的响应
      const header = Buffer.alloc(4);
      header.writeUInt32LE(0, 0);
      daemonProc.stdout.emit('data', header);

      const result = await promise;
      expect(result).toEqual(Buffer.alloc(0));
    });

    it('_talkToDaemon 超时时 kill 进程并退化到 spawnPython', async () => {
      vi.useFakeTimers();
      const fallbackProc = createMockProcess();

      // 第一次 spawn 给 _ensureDaemon，第二次给 spawnPython fallback
      mockSpawn.mockReturnValueOnce(daemonProc).mockReturnValueOnce(fallbackProc);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      const promise = (bridge as any)._talkToDaemon('你好');

      // 前进 30 秒触发超时
      await vi.advanceTimersByTimeAsync(30000);

      // 超时后 daemon 被 kill
      expect(daemonProc.kill).toHaveBeenCalled();
      expect((bridge as any)._daemonProc).toBeNull();

      // 此时 spawnPython fallback 已在运行，快速完成它
      await new Promise(process.nextTick);
      fallbackProc.stdout.emit('data', Buffer.from('fallback'));
      fallbackProc.emit('close', 0);

      const result = await promise;
      expect(result).toEqual(Buffer.from('fallback'));
    });

    it('_talkToDaemon stdin 写入失败时退化到 spawnPython', async () => {
      const fallbackProc = createMockProcess();

      mockSpawn.mockReturnValueOnce(daemonProc).mockReturnValueOnce(fallbackProc);
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      // 让 stdin.write 抛出异常
      daemonProc.stdin.write = vi.fn(() => { throw new Error('stdin closed'); });

      const promise = (bridge as any)._talkToDaemon('你好');

      // spawnPython fallback 已在执行，完成它
      await new Promise(process.nextTick);
      fallbackProc.stdout.emit('data', Buffer.from('fallback-data'));
      fallbackProc.emit('close', 0);

      const result = await promise;
      expect(result).toEqual(Buffer.from('fallback-data'));
      expect((bridge as any)._daemonProc).toBeNull();  // daemon 被标记为失效
    });

    // ----- speak 现在直接走 spawnPython（不再通过 daemon） -----

    it('speak 直接调用 spawnPython 生成语音', async () => {
      const mp3Data = Buffer.from('spawn-output');
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      (readFile as any).mockRejectedValue(new Error('not found'));
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      await new Promise(process.nextTick);
      proc.stdout.emit('data', mp3Data);
      proc.emit('close', 0);

      const result = await promise;
      expect(result).toEqual(mp3Data);
      expect(mockSpawn).toHaveBeenCalledWith(
        'python',
        ['/fake/tts_bridge.py', '你好'],
        expect.any(Object),
      );
    });

    it('speak spawnPython 失败时返回空 Buffer', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      (readFile as any).mockRejectedValue(new Error('not found'));
      (mkdir as any).mockResolvedValue(undefined);
      bridge = new TTSBridge({ scriptPath: '/fake/tts_bridge.py', _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      await new Promise(process.nextTick);
      proc.emit('close', 1);

      const result = await promise;
      expect(result).toEqual(Buffer.alloc(0));
    });

    it('speak spawnPython 返回空时不做磁盘缓存', async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);
      (readFile as any).mockRejectedValue(new Error('not found'));
      (mkdir as any).mockResolvedValue(undefined);
      bridge = new TTSBridge({ _spawn: mockSpawn as unknown as SpawnFn });

      const promise = bridge.speak('你好');

      await new Promise(process.nextTick);
      proc.stdout.emit('data', Buffer.from(''));
      proc.emit('close', 0);

      const result = await promise;
      expect(result).toEqual(Buffer.alloc(0));
      expect(writeFile).not.toHaveBeenCalled();
    });
  });
});
