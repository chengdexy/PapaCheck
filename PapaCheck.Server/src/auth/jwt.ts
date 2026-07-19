import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JWTPayload } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadOrCreateSecret(): string {
  // 优先使用环境变量（生产环境必须注入 JWT_SECRET）
  const envSecret = process.env['JWT_SECRET'];
  if (envSecret) return envSecret;

  // 其次读取持久化密钥文件（仅开发 / 自托管场景）
  const dataDir = resolve(__dirname, '../../data');
  const secretFile = resolve(dataDir, '.jwt_secret');
  if (existsSync(secretFile)) {
    return readFileSync(secretFile, 'utf-8').trim();
  }

  // 生产 / 非开发环境：缺失 JWT_SECRET 且无可读密钥文件时，禁止退化为随机密钥，直接抛错
  if (process.env['NODE_ENV'] !== 'development') {
    throw new Error(
      'JWT_SECRET 未配置且未找到持久化密钥文件。生产环境必须通过环境变量注入 JWT_SECRET，' +
      '禁止退化为随机密钥（会导致已签发 token 全部失效，且存在密钥不一致风险）。'
    );
  }

  // 开发环境：生成并持久化一个本地密钥
  const secret = crypto.randomBytes(32).toString('hex');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(secretFile, secret, 'utf-8');
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
