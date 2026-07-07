import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const CDN_BASE_URL = 'https://6368-child-teacher-parent-d9aef9d2208-1253991009.tcb.qcloud.la';

export interface UploadOptions {
  envId: string;
  localPath: string;
  cloudPath: string;
}

/**
 * 使用 tcb CLI 上传 APK 到 CloudBase 云存储
 * tcb storage upload <本地路径> <云存储路径> --envId <环境ID>
 */
export async function uploadApk(options: UploadOptions): Promise<void> {
  const { envId, localPath, cloudPath } = options;
  await execFileAsync('tcb', [
    'storage', 'upload', localPath, cloudPath,
    '--envId', envId,
  ]);
}
