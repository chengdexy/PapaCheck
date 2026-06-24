import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:papacheck/services/cache_clear_helper.dart';

void main() {
  // Feature: shouldClearCache 缓存清理决策
  //
  //   Scenario: 版本号一致时不清理缓存
  //     Given ConfigService 中已记录的版本号为 "1.0.0"
  //     And 当前版本号也为 "1.0.0"
  //     When 调用 shouldClearCache("1.0.0")
  //     Then 返回 false（版本未变更，不需要清理缓存）
  test('版本一致时返回 false', () async {
    SharedPreferences.setMockInitialValues({'last_version': '1.0.0'});
    final result = await shouldClearCache('1.0.0');
    expect(result, isFalse);
  });

  //   Scenario: 版本号不一致时清理缓存
  //     Given ConfigService 中已记录的版本号为 "1.0.0"
  //     And 当前版本号为 "2.0.0"
  //     When 调用 shouldClearCache("2.0.0")
  //     Then 返回 true（版本已变更，需要清理缓存）
  test('版本不一致时返回 true', () async {
    SharedPreferences.setMockInitialValues({'last_version': '1.0.0'});
    final result = await shouldClearCache('2.0.0');
    expect(result, isTrue);
  });

  //   Scenario: 首次运行（无记录版本号）时不清理缓存
  //     Given 从未存储过版本号（首次安装）
  //     And 当前版本号为 "1.0.0"
  //     When 调用 shouldClearCache("1.0.0")
  //     Then 返回 false（首次安装不清理，只需记录版本号）
  test('首次运行（无记录版本号）时返回 false', () async {
    SharedPreferences.setMockInitialValues({});
    final result = await shouldClearCache('1.0.0');
    expect(result, isFalse);
  });
}
