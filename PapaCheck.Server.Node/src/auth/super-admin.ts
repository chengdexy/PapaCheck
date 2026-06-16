import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { IDatabase } from '../db/types.js';

export async function ensureSuperAdmin(db: IDatabase): Promise<{ email: string; password: string } | null> {
  // Check if super admin already exists (look for any user with role='admin')
  const checkEmail = 'admin@papacheck.internal';
  const existing = await db.findUserByEmail(checkEmail);
  if (existing) return null;

  const password = 'admin-' + crypto.randomBytes(4).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 10);
  const id = crypto.randomUUID();
  const email = 'admin-' + crypto.randomBytes(3).toString('hex') + '@papacheck.internal';

  try {
    await db.createUser({
      id,
      role: 'admin',
      email,
      password_hash: passwordHash,
      family_name: null,
      token_version: 1,
    });
  } catch (e) {
    // Check if another admin was created in a race condition
    const stillExists = await db.findUserByEmail(checkEmail);
    if (stillExists) return null;
    console.error('创建超级管理员失败:', e);
    return null;
  }

  console.log(`\n🔐 超级管理员已创建`);
  console.log(`   邮箱: ${email}`);
  console.log(`   密码: ${password}`);
  console.log(`   首次登录后请立即修改凭证\n`);

  return { email, password };
}
