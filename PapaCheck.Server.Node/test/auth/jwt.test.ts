import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../../src/auth/jwt.js';

describe('JWT Utilities', () => {
  // Feature: JWT 签名与验证
  //   Scenario: 签署有效 token 后能验证出正确 payload
  //     Given 一个有效的 JWTPayload
  //     When  调用 signToken 签署
  //     Then  返回一个 JWT 字符串
  //     And   调用 verifyToken 能验证出正确的 sub/tenant_id/role/token_version

  it('should sign and verify a valid token returning correct payload', () => {
    const payload = {
      sub: 'user-123',
      tenant_id: 'tenant-456',
      role: 'parent' as const,
      token_version: 1,
    };

    const token = signToken(payload);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('user-123');
    expect(decoded!.tenant_id).toBe('tenant-456');
    expect(decoded!.role).toBe('parent');
    expect(decoded!.token_version).toBe(1);
  });

  // Feature: JWT 验证
  //   Scenario: 无效 token 返回 null
  //     Given 一个非 JWT 格式的字符串
  //     When  调用 verifyToken
  //     Then  返回 null

  it('should return null for an invalid token', () => {
    const result = verifyToken('not-a-jwt-token');
    expect(result).toBeNull();
  });

  // Feature: JWT 防篡改
  //   Scenario: 被篡改的 token 验证失败
  //     Given 一个有效的 JWT
  //     When  篡改 payload 部分
  //     Then  verifyToken 返回 null

  it('should return null for a tampered token', () => {
    const payload = {
      sub: 'user-123',
      tenant_id: 'tenant-456',
      role: 'parent' as const,
      token_version: 1,
    };

    const token = signToken(payload);
    // 篡改 payload 部分：将 payload 的一部分替换
    const parts = token.split('.');
    const tamperedToken = parts[0] + '.' + parts[1] + 'tampered.' + parts[2];

    const decoded = verifyToken(tamperedToken);
    expect(decoded).toBeNull();
  });
});
