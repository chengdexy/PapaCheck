import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, callback) => callback(null, { stdout: '', stderr: '' })),
}));

import { uploadApk } from '../lib/storage-upload.js';

describe('storage-upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploadApk 调用 tcb storage objects upload', async () => {
    await uploadApk({
      envId: 'test-env',
      localPath: '/tmp/PapaCheck-1.5.4.apk',
      cloudPath: 'dist/PapaCheck-1.5.4.apk',
    });
    const { execFile } = await import('child_process');
    expect(execFile).toHaveBeenCalledWith(
      'tcb',
      expect.arrayContaining(['storage', 'objects', 'upload']),
      expect.any(Function)
    );
  });
});
