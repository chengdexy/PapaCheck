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
 * tcb storage objects upload <localPath> <key> --bucket <bucketId>
 * --env-id 指定环境 ID，--bucket 指定存储桶
 */
export async function uploadApk(options: UploadOptions): Promise<void> {
  const { envId, localPath, cloudPath } = options;
  // dist 是 PG 环境下公有读的存储桶（100MB 限制），用于存放 APK 安装包
  const bucketId = 'dist';
  await execFileAsync('tcb', [
    'storage', 'objects', 'upload', localPath, cloudPath,
    '--env-id', envId,
    '--bucket', bucketId,
    '--upsert',
  ]);
}
