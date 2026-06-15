import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { JWTPayload } from './types.js';

const JWT_SECRET: string = process.env['JWT_SECRET'] ?? crypto.randomBytes(32).toString('hex');

const JWT_EXPIRY = '365d';

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
