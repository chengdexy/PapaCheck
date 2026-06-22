import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JWTPayload } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadOrCreateSecret(): string {
  // 优先使用环境变量
  const envSecret = process.env['JWT_SECRET'];
  if (envSecret) return envSecret;

  // 尝试从文件读取
  const dataDir = resolve(__dirname, '../../data');
  const secretFile = resolve(dataDir, '.jwt_secret');

  if (existsSync(secretFile)) {
    return readFileSync(secretFile, 'utf-8').trim();
  }

  // 生成并持久化
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
  } catch {
    return null;
  }
}
