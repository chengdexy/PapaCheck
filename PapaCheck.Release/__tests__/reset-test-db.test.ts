// Feature: 测试数据库 schema 重置
//   作为发布工具
//   我希望 reset-test-db 脚本能正确解析依赖和路径
//   这样云同步前能自动修复测试库 schema 状态
//
//   Scenario: 模块可被加载
//     Given reset-test-db.ts 存在
//     When import 该模块
//     Then 不抛出模块解析错误
//
//   Scenario: schema 路径解析正确
//     Given reset-test-db.ts 位于 PapaCheck.Release/lib/
//     When 构造 schema 文件路径
//     Then 路径指向 PapaCheck.Server/scripts/init-pg-schema.sql
//     And 该文件存在

import { describe, test, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('reset-test-db', () => {

  test('模块可正常加载（依赖 pg 包已安装）', async () => {
    const mod = await import('../lib/reset-test-db.js');
    expect(mod).toBeDefined();
  });

  test('schema 文件路径有效', () => {
    const schemaPath = resolve(__dirname, '../../PapaCheck.Server/scripts/init-pg-schema.sql');
    expect(existsSync(schemaPath)).toBe(true);
  });

});
