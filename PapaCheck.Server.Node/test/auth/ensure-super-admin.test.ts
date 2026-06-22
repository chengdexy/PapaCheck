/**
 * ensure-super-admin.test.ts - ensureSuperAdmin 重复创建 Bug 修复测试
 *
 * Bug：超管修改邮箱后，ensureSuperAdmin 按默认邮箱查不到人，重启时会重复创建超管。
 * 修复：改为按角色（role=admin）判重，而非按默认邮箱。
 */
import { describe, it, expect } from 'vitest';
import { ensureSuperAdmin } from '../../src/auth/super-admin.js';

/// Feature: 超级管理员创建防重复
///   Scenario: 已存在超管时，ensureSuperAdmin 不重复创建
///     Given 数据库中有且仅有一个超管账号（邮箱已修改为自定义值）
///     When 调用 ensureSuperAdmin()
///     Then 不创建新超管，返回 null
///     And 数据库中仍只有一个超管

describe('ensureSuperAdmin 防重复', () => {
  /// Feature: 超级管理员创建防重复
  ///   Scenario: 已存在超管（非默认邮箱）时，ensureSuperAdmin 不重复创建
  ///     Given 数据库中有一个超管，邮箱已从默认值改为 custom@test.com
  ///     When 调用 ensureSuperAdmin()
  ///     Then 不创建新超管，返回 null
  ///     And findAdminByEmail 从未被调用
  it('已存在超管（非默认邮箱）时不重复创建', async () => {
    let findAdminExistsCalled = false;
    let createUserCalled = false;

    const mockDb = {
      findAdminExists: async () => {
        findAdminExistsCalled = true;
        return true; // 存在超管
      },
      createUser: async (_input: any) => {
        createUserCalled = true;
      },
    } as any;

    const result = await ensureSuperAdmin(mockDb);

    expect(result).toBeNull();
    expect(findAdminExistsCalled).toBe(true);
    expect(createUserCalled).toBe(false);
  });

  /// Feature: 超级管理员创建防重复
  ///   Scenario: 数据库中无超管时，ensureSuperAdmin 正常创建
  ///     Given 数据库中没有任何超管
  ///     When 调用 ensureSuperAdmin()
  ///     Then 创建默认超管账号
  ///     And 返回邮箱和密码
  it('无超管时正常创建', async () => {
    let findAdminExistsCalled = false;
    let createUserCalled = false;

    const mockDb = {
      findAdminExists: async () => {
        findAdminExistsCalled = true;
        return false; // 无超管
      },
      createUser: async (_input: any) => {
        createUserCalled = true;
      },
    } as any;

    const result = await ensureSuperAdmin(mockDb);

    expect(result).not.toBeNull();
    expect(result!.email).toBe('admin@papacheck.internal');
    expect(result!.password).toMatch(/^admin-/);
    expect(findAdminExistsCalled).toBe(true);
    expect(createUserCalled).toBe(true);
  });
});
