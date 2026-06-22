/**
 * compiled-middleware.test.ts - 编译产物验证测试
 *
 * 确保编译后的 dist/auth/middleware.js 中的 PUBLIC_PATHS
 * 与源代码（middleware.ts）保持同步。
 * 防止部署时 dist/ 过旧导致认证拦截问题。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_MIDDLEWARE = resolve(__dirname, '../../dist/auth/middleware.js');

describe('Compiled Middleware', () => {
  // Feature: 编译产物必须存在
  //   Scenario: dist/auth/middleware.js 存在
  //     Given 项目已执行 npm run build
  //     When  检查 dist/auth/middleware.js
  //     Then  文件必须存在

  it('should have compiled dist/auth/middleware.js', () => {
    expect(existsSync(DIST_MIDDLEWARE)).toBe(true);
  });

  // Feature: PUBLIC_PATHS 不应包含 /api/speak（已改为需鉴权）
  //   Scenario: /api/speak 不在公开路径白名单中
  //     Given dist/auth/middleware.js 已编译
  //     When  读取文件内容
  //     Then  PUBLIC_PATHS 中不应包含 '/api/speak'

  it('should NOT include /api/speak in PUBLIC_PATHS', () => {
    if (!existsSync(DIST_MIDDLEWARE)) {
      return; // 跳过，由上一个测试负责报告
    }
    const content = readFileSync(DIST_MIDDLEWARE, 'utf-8');
    // 在 PUBLIC_PATHS 的 new Set([...]) 中查找 /api/speak
    const publicPathsMatch = content.match(/new Set\(\[([\s\S]*?)\]\)/);
    expect(publicPathsMatch).not.toBeNull();
    expect(publicPathsMatch![1]).not.toContain('/api/speak');
  });

  // Feature: 源代码中的 PUBLIC_PATHS 与编译产物一致
  //   Scenario: 源代码和编译产物包含相同的公开路径集合
  //     Given 源代码 middleware.ts 和编译产物 middleware.js
  //     When  比较两者的 PUBLIC_PATHS
  //     Then  必须一致

  it('should have same PUBLIC_PATHS as source', () => {
    if (!existsSync(DIST_MIDDLEWARE)) {
      return; // 跳过
    }
    const SRC_MIDDLEWARE = resolve(__dirname, '../../src/auth/middleware.ts');
    if (!existsSync(SRC_MIDDLEWARE)) return; // 跳过

    const srcContent = readFileSync(SRC_MIDDLEWARE, 'utf-8');
    const distContent = readFileSync(DIST_MIDDLEWARE, 'utf-8');

    // 提取 PUBLIC_PATHS 中的路径列表
    const srcPaths = extractPublicPaths(srcContent);
    const distPaths = extractPublicPaths(distContent);

    expect(distPaths.sort()).toEqual(srcPaths.sort());
  });
});

function extractPublicPaths(content: string): string[] {
  const match = content.match(/PUBLIC_PATHS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(s => s.trim().replace(/['"\/]/g, '').replace(/\/$/, ''))
    .filter(Boolean);
}
