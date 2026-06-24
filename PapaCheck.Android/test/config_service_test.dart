import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:papacheck/services/config_service.dart';

void main() {
  // Feature: ConfigService 版本号存储
  //   Scenario: 存储版本号后能正确读取
  //     Given 应用已设置版本号 "1.2.9+35"
  //     When 调用 getLastVersion()
  //     Then 返回 "1.2.9+35"
  test('setLastVersion 存储版本号后 getLastVersion 返回相同的值', () async {
    SharedPreferences.setMockInitialValues({});
    await ConfigService.setLastVersion('1.2.9+35');
    final result = await ConfigService.getLastVersion();
    expect(result, equals('1.2.9+35'));
  });

  // Feature: ConfigService 版本号存储
  //   Scenario: 首次调用返回 null
  //     Given 从未存储过版本号
  //     When 调用 getLastVersion()
  //     Then 返回 null
  test('首次调用 getLastVersion 返回 null', () async {
    SharedPreferences.setMockInitialValues({});
    final result = await ConfigService.getLastVersion();
    expect(result, isNull);
  });

  // ========== Auth token persistence (Android WebView session restore) ==========

  // Feature: Android WebView 会话恢复 - Auth Token 持久化
  //   Scenario: 登录后保存 auth token
  //     Given 用户已成功登录家长端
  //     When 调用 ConfigService.setAuthData(token: "test-jwt", role: "parent", childName: "小明")
  //     Then getAuthToken() 返回 "test-jwt"
  //     And getAuthRole() 返回 "parent"
  //     And getAuthChildName() 返回 "小明"
  test('setAuthData 存储后 getAuthToken/getAuthRole/getAuthChildName 返回对应的值', () async {
    SharedPreferences.setMockInitialValues({});
    await ConfigService.setAuthData(
      token: 'test-jwt',
      role: 'parent',
      childName: '小明',
    );

    expect(await ConfigService.getAuthToken(), equals('test-jwt'));
    expect(await ConfigService.getAuthRole(), equals('parent'));
    expect(await ConfigService.getAuthChildName(), equals('小明'));
  });

  // Feature: Android WebView 会话恢复 - Auth Token 持久化
  //   Scenario: 未登录时 auth token 均返回 null
  //     Given 从未调用 setAuthData
  //     When 调用各个 getter
  //     Then 全部返回 null
  test('未调用 setAuthData 时 getAuthToken/getAuthRole/getAuthChildName 返回 null', () async {
    SharedPreferences.setMockInitialValues({});

    expect(await ConfigService.getAuthToken(), isNull);
    expect(await ConfigService.getAuthRole(), isNull);
    expect(await ConfigService.getAuthChildName(), isNull);
  });

  // Feature: Android WebView 会话恢复 - Auth Token 持久化
  //   Scenario: clearAuth 清除后所有 getter 返回 null
  //     Given 已调用 setAuthData(token: "xxx")
  //     When 调用 clearAuth()
  //     Then 所有 getter 返回 null
  test('clearAuth 清除后 getAuthToken/getAuthRole/getAuthChildName 返回 null', () async {
    SharedPreferences.setMockInitialValues({});
    await ConfigService.setAuthData(
      token: 'test-jwt',
      role: 'parent',
      childName: '小明',
    );

    await ConfigService.clearAuth();

    expect(await ConfigService.getAuthToken(), isNull);
    expect(await ConfigService.getAuthRole(), isNull);
    expect(await ConfigService.getAuthChildName(), isNull);
  });

  // Feature: Android WebView 会话恢复 - Auth Token 持久化
  //   Scenario: 重复调用 setAuthData 覆盖旧值
  //     Given 已调用 setAuthData(token: "old")
  //     When 再次调用 setAuthData(token: "new")
  //     Then getAuthToken() 返回 "new"
  test('重复调用 setAuthData 覆盖旧值', () async {
    SharedPreferences.setMockInitialValues({});
    await ConfigService.setAuthData(token: 'old-token');
    await ConfigService.setAuthData(token: 'new-token');

    expect(await ConfigService.getAuthToken(), equals('new-token'));
  });

  // Feature: Android WebView 会话恢复 - Auth Token 持久化
  //   Scenario: setAuthData 仅传 token 时 role 和 childName 保持空字符串
  //     Given 从未调用 setAuthData
  //     When 调用 setAuthData(token: "xxx")（不传 role 和 childName）
  //     Then getAuthToken() 返回 "xxx"
  //     And getAuthRole() 返回空字符串
  //     And getAuthChildName() 返回空字符串
  test('setAuthData 仅传 token 时 role 和 childName 默认空字符串', () async {
    SharedPreferences.setMockInitialValues({});
    await ConfigService.setAuthData(token: 'just-token');

    expect(await ConfigService.getAuthToken(), equals('just-token'));
    expect(await ConfigService.getAuthRole(), equals(''));
    expect(await ConfigService.getAuthChildName(), equals(''));
  });
}
