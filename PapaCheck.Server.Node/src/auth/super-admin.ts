import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { IDatabase } from '../db/types.js';

const DEFAULT_ADMIN_EMAIL = 'admin@papacheck.internal';

export async function ensureSuperAdmin(db: IDatabase): Promise<{ email: string; password: string } | null> {
  // Check if any super admin already exists (by role, not by default email)
  // Using role check prevents duplicate creation when admin changes their email
  const adminExists = await db.findAdminExists();
  if (adminExists) return null;

  const password = 'admin-' + crypto.randomBytes(4).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 10);
  const id = crypto.randomUUID();

  try {
    await db.createUser({
      id,
      role: 'admin',
      email: DEFAULT_ADMIN_EMAIL,
      password_hash: passwordHash,
      token_version: 1,
    });
  } catch (e) {
    const stillExists = await db.findUserByEmail(DEFAULT_ADMIN_EMAIL);
    if (stillExists) return null;
    console.error('创建超级管理员失败:', e);
    return null;
  }

  console.log(`\n🔐 超级管理员已创建`);
  console.log(`   邮箱: ${DEFAULT_ADMIN_EMAIL}`);
  console.log(`   密码: ${password}`);
  console.log(`   首次登录后请立即修改凭证\n`);

  return { email: DEFAULT_ADMIN_EMAIL, password };
}
