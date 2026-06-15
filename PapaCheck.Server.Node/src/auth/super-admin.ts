import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IDatabase } from '../db/types.js';

const SUPER_ADMIN_USERNAME = 'admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getAdminsPath(): string {
  const dataDir = resolve(__dirname, '../../data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return resolve(dataDir, 'admins.json');
}

function saveAdminToJson(id: string, username: string, email: string, passwordHash: string): void {
  const adminsPath = getAdminsPath();
  let admins: any[] = [];
  if (existsSync(adminsPath)) {
    const content = readFileSync(adminsPath, 'utf-8');
    admins = JSON.parse(content);
  }
  admins.push({
    id,
    username,
    email,
    password_hash: passwordHash,
    token_version: 1,
    created_at: new Date().toISOString(),
  });
  writeFileSync(adminsPath, JSON.stringify(admins, null, 2), 'utf-8');
}

export async function ensureSuperAdmin(db: IDatabase): Promise<{ username: string; password: string } | null> {
  // Check if super admin already exists
  const existing = await db.findSuperAdmin(SUPER_ADMIN_USERNAME);
  if (existing) return null; // already exists

  // Create super admin credentials
  const password = 'admin-' + crypto.randomBytes(4).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 10);
  const id = crypto.randomUUID();

  // Try Postgres insert if available
  const pool = (db as any).pool;
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO users (id, tenant_id, role, nickname, access_hash, token_version, email, password_hash, is_super_admin, is_active)
         VALUES ($1, '__super_admin__', 'parent', '超级管理员', '', 1, $2, $3, true, true)
         ON CONFLICT (id) DO NOTHING`,
        [id, SUPER_ADMIN_USERNAME, passwordHash]
      );
      return { username: SUPER_ADMIN_USERNAME, password };
    } catch (e) {
      console.error('Postgres 创建超级管理员失败，尝试 JSON 文件:', e);
      // Fall through to JSON approach
    }
  }

  // Fallback: write to data/admins.json (works for SqliteAdapter and as fallback)
  try {
    saveAdminToJson(id, SUPER_ADMIN_USERNAME, SUPER_ADMIN_USERNAME, passwordHash);
    return { username: SUPER_ADMIN_USERNAME, password };
  } catch (e) {
    console.error('创建超级管理员失败:', e);
    return null;
  }
}
