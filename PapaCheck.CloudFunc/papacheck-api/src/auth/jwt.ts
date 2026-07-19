import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JWTPayload } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadOrCreateSecret(): string {
  // 优先使用环境变量（生产环境通过 JWT_SECRET 注入时，密钥稳定且跨冷启动一致）
  const envSecret = process.env['JWT_SECRET'];
  if (envSecret) return envSecret;

  // 其次读取随部署包一同上传的密钥文件（CloudBase SCF 的 /var/user 只读但可读，
  // 故部署时把 jwt.secret 打进 dist/ 即可在运行时稳定读取，跨冷启动一致）。
  const secretFile = resolve(__dirname, 'jwt.secret');
  if (existsSync(secretFile)) {
    try {
      return readFileSync(secretFile, 'utf-8').trim();
    } catch {
      // 读取失败则继续生成
    }
  }

  // 生产 / 非开发环境：禁止退化为随机（内存）密钥，直接抛错
  if (process.env['NODE_ENV'] !== 'development') {
    throw new Error(
      'JWT_SECRET 未配置且未找到持久化密钥文件（jwt.secret）。生产环境必须通过环境变量注入 JWT_SECRET，' +
      '禁止退化为随机密钥（会导致已签发 token 全部失效，且存在密钥不一致风险）。'
    );
  }

  // 开发环境：生成并尽量持久化
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    writeFileSync(secretFile, secret, 'utf-8');
  } catch {
    console.warn('[jwt] 无法写入 JWT 密钥文件，已退化为内存密钥（开发环境，重启后失效）。请配置 JWT_SECRET 环境变量或随包部署 jwt.secret。');
  }
  return secret;
}

const JWT_SECRET: string = loadOrCreateSecret();
const JWT_EXPIRY = '30d';

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (err: any) {
    // 区分过期 / 签名错误 / 其它异常，便于排查（不再无差别吞掉）
    if (err?.name === 'TokenExpiredError') {
      console.warn('[jwt] token 已过期');
    } else if (err?.name === 'JsonWebTokenError') {
      console.warn('[jwt] token 无效:', err?.message);
    } else {
      console.error('[jwt] token 校验异常:', err);
    }
    return null;
  }
}
