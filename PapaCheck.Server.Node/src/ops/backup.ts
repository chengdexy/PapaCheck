import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import crypto from 'node:crypto';
import type { IDatabase, BackupRecord, OpsConfig } from '../db/types.js';

const BACKUP_DIR_DEFAULT = '/var/backups/papacheck/';
const FILENAME_REGEX = /^papacheck-\d{8}-\d{6}\.sql\.gz$/;

/** Generate backup filename: papacheck-YYYYMMDD-HHmmss.sql.gz */
function generateFilename(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `papacheck-${y}${m}${d}-${h}${min}${s}.sql.gz`;
}

/** Compute SHA256 of a file */
async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Get pg_dump connection string from DATABASE_URL env var */
function getConnectionString(): string {
  return process.env['DATABASE_URL'] || 'postgresql://localhost:5432/papacheck';
}

/** Run a single pg_dump backup */
export async function runBackup(db: IDatabase, triggeredBy: string = 'scheduler'): Promise<BackupRecord> {
  const opsConfig: OpsConfig | null = await db.getOpsConfig();
  const backupDir = opsConfig?.backup?.backupDir ?? BACKUP_DIR_DEFAULT;
  const retentionCount = opsConfig?.backup?.retentionCount ?? 3;
  const filename = generateFilename();
  const filePath = join(backupDir, filename);
  const recordId = randomUUID();
  const now = new Date().toISOString();

  // Ensure backup directory exists
  await mkdir(backupDir, { recursive: true, mode: 0o700 });

  try {
    // Run pg_dump
    const dbUrl = new URL(getConnectionString());
    const dbName = dbUrl.pathname.replace(/^\//, '') || 'papacheck';
    const dbHost = dbUrl.hostname || 'localhost';
    const dbUser = dbUrl.username || 'papacheck';
    await new Promise<void>((resolvePromise, rejectPromise) => {
      execFile('pg_dump', ['-Fc', '-h', dbHost, '-U', dbUser, '-f', filePath, dbName], {
        env: { ...process.env, PGPASSWORD: dbUrl.password || '' },
        timeout: 120_000, // 2 minute timeout
      }, (error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
    });

    // Verify file exists and get size
    const fileStat = await stat(filePath);
    if (fileStat.size <= 0) throw new Error('Backup file is empty');

    // Compute checksum
    const checksum = await sha256File(filePath);

    const record: BackupRecord = {
      id: recordId,
      filename,
      size_bytes: fileStat.size,
      status: 'success',
      error_message: null,
      checksum,
      created_at: now,
      triggered_by: triggeredBy,
    };

    await db.insertBackupRecord(record);

    // Prune old backups
    await pruneOldBackups(db, retentionCount);

    return record;
  } catch (err: any) {
    const record: BackupRecord = {
      id: recordId,
      filename,
      size_bytes: null,
      status: 'failed',
      error_message: err.message || String(err),
      checksum: null,
      created_at: now,
      triggered_by: triggeredBy,
    };
    await db.insertBackupRecord(record);

    // Clean up the failed file
    try { await unlink(filePath); } catch { /* ignore */ }

    return record;
  }
}

/** Manually trigger a backup (called from admin panel) */
export async function triggerBackupManually(db: IDatabase, adminId: string): Promise<BackupRecord> {
  return runBackup(db, `admin:${adminId}`);
}

/** List recent backup records */
export async function listBackups(db: IDatabase, limit: number = 20): Promise<BackupRecord[]> {
  return db.listBackupRecords(limit);
}

/** Get backup file path with path traversal protection */
export function getBackupFilePath(filename: string, backupDir?: string): string | null {
  if (!FILENAME_REGEX.test(filename)) return null;
  const dir = backupDir ?? BACKUP_DIR_DEFAULT;
  const fullPath = resolve(join(dir, filename));
  // Ensure resolved path is still within dir
  if (!fullPath.startsWith(resolve(dir))) return null;
  if (!existsSync(fullPath)) return null;
  return fullPath;
}

/** Prune old backups, keeping only the most recent `retentionCount` successful ones */
export async function pruneOldBackups(db: IDatabase, retentionCount: number): Promise<number> {
  const deleted = await db.deleteBackupRecordsOlderThan(retentionCount);
  const opsConfig: OpsConfig | null = await db.getOpsConfig();
  const backupDir = opsConfig?.backup?.backupDir ?? BACKUP_DIR_DEFAULT;
  let removedCount = 0;
  for (const record of deleted) {
    const filePath = join(backupDir, record.filename);
    try {
      await unlink(filePath);
      removedCount++;
    } catch {
      // File may already be gone, that's fine
    }
  }
  return removedCount;
}
