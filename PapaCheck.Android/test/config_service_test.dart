import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:papacheck_android/services/config_service.dart';

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
}
