// Feature: APK 版本管理
//   作为发布工具
//   我希望正确读取和解析 APK 版本号
//   这样构建时能按规则递增或设定版本
//
//   Scenario: 从 pubspec.yaml 读取版本号
//     Given pubspec.yaml 包含 version: 1.4.0+59
//     When 调用 readApkVersion()
//     Then 返回 "1.4.0"
//
//   Scenario: 读取失败则返回 0.0.0
//     Given pubspec.yaml 不存在 version 字段
//     When 调用 readApkVersion()
//     Then 返回 "0.0.0"
//
//   Scenario: bump patch 递增末位
//     Given 当前版本 "1.4.0"
//     When resolveVersion(current, { bump: 'patch' })
//     Then 返回 "1.4.1"
//
//   Scenario: bump minor 递增中间位
//     Given 当前版本 "1.4.0"
//     When resolveVersion(current, { bump: 'minor' })
//     Then 返回 "1.5.0"
//
//   Scenario: bump major 递增首位
//     Given 当前版本 "1.4.0"
//     When resolveVersion(current, { bump: 'major' })
//     Then 返回 "2.0.0"
//
//   Scenario: 默认 bump 为 patch
//     Given 当前版本 "1.4.0"
//     When resolveVersion(current, {})
//     Then 返回 "1.4.1"
//
//   Scenario: --ver 直接设定版本
//     Given 当前版本 "1.4.0"
//     When resolveVersion(current, { ver: '2.0.0' })
//     Then 返回 "2.0.0"
//
//   Scenario: --no-bump 保持当前版本
//     Given 当前版本 "1.4.0"
//     When resolveVersion(current, { noBump: true })
//     Then 返回 "1.4.0"

import { describe, test, expect } from 'vitest';
import { resolveVersion } from '../lib/build-apk.js';

describe('build-apk 版本管理', () => {

  test('bump patch 递增末位', () => {
    expect(resolveVersion('1.4.0', { bump: 'patch' })).toBe('1.4.1');
  });

  test('bump minor 递增中间位', () => {
    expect(resolveVersion('1.4.0', { bump: 'minor' })).toBe('1.5.0');
  });

  test('bump major 递增首位', () => {
    expect(resolveVersion('1.4.0', { bump: 'major' })).toBe('2.0.0');
  });

  test('默认 bump 为 patch', () => {
    expect(resolveVersion('1.4.0', {})).toBe('1.4.1');
  });

  test('--ver 直接设定版本', () => {
    expect(resolveVersion('1.4.0', { ver: '2.0.0' })).toBe('2.0.0');
  });

  test('--no-bump 保持当前版本', () => {
    expect(resolveVersion('1.4.0', { noBump: true })).toBe('1.4.0');
  });

  test('--ver 格式非法时抛出错误', () => {
    expect(() => resolveVersion('1.4.0', { ver: 'abc' })).toThrow('版本号格式错误');
    expect(() => resolveVersion('1.4.0', { ver: '1.2' })).toThrow('版本号格式错误');
  });

});
