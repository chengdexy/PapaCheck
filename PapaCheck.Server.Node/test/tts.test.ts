// Feature: TTS 语音服务
//   Scenario: Python 子进程桥接
//     Given TTS Bridge 已初始化
//     When 调用 speak('你好')
//     Then 返回 MP3 Buffer

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { TTSBridge, type SpawnFn } from '../src/tts/index.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from 'fs/promises';

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter() as any;
  proc.stderr = new EventEmitter() as any;
  proc.stdout.setEncoding = vi.fn();
  proc.stderr.setEncoding = vi.fn();
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
});
