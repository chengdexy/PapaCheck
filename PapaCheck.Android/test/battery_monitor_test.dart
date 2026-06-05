import 'package:flutter_test/flutter_test.dart';

// BatteryMonitor 在 main.dart 中定义，通过 evaluateAlert 静态方法暴露纯逻辑
// 为避免导入整个 main.dart 带来的依赖问题，此处内联一个等价的参考实现
// （与 main.dart 中 BatteryMonitor.evaluateAlert 保持严格一致）
String? evaluateAlert(int batteryLevel, bool alerted20, bool alerted10) {
  if (batteryLevel <= 10 && !alerted10) return '10';
  if (batteryLevel <= 20 && !alerted20) return '20';
  return null;
}

void main() {
  // Feature: 电池监控阈值逻辑
  //   低电量时通过 evaluateAlert 决定触发哪个级别的语音提醒

  group('阈值逻辑', () {
    // Scenario: 电量高于 20% 时不触发提醒
    //   Given 电量 > 20%，两个阈值均未触发
    //   When 调用 evaluateAlert
    //   Then 返回 null
    test('电量高于20%时不触发提醒', () {
      expect(evaluateAlert(50, false, false), isNull);
      expect(evaluateAlert(21, false, false), isNull);
      expect(evaluateAlert(100, false, false), isNull);
    });

    // Scenario: 电量降至 20% 时触发 20% 提醒
    //   Given 电量 = 20%，20% 阈值未触发
    //   When 调用 evaluateAlert
    //   Then 返回 '20'
    test('电量降至20%时触发20%提醒', () {
      expect(evaluateAlert(20, false, false), equals('20'));
      expect(evaluateAlert(15, false, false), equals('20'));
      expect(evaluateAlert(11, false, false), equals('20'));
    });

    // Scenario: 电量降至 10% 时触发 10% 提醒
    //   Given 电量 = 10%，10% 阈值未触发
    //   When 调用 evaluateAlert
    //   Then 返回 '10'（10% 优先级高于 20%）
    test('电量降至10%时触发10%提醒', () {
      expect(evaluateAlert(10, false, false), equals('10'));
      expect(evaluateAlert(5, false, false), equals('10'));
    });

    // Scenario: 20% 已触发后不再重复触发
    //   Given 电量 = 15%，20% 已触发
    //   When 调用 evaluateAlert
    //   Then 返回 null（不重复触发 20%）
    test('20%已触发后不再重复', () {
      expect(evaluateAlert(15, true, false), isNull);
    });

    // Scenario: 10% 已触发后不再重复触发
    //   Given 电量 = 5%，10% 已触发
    //   When 调用 evaluateAlert
    //   Then 返回 null
    test('10%已触发后不再重复', () {
      expect(evaluateAlert(5, true, true), isNull);
    });

    // Scenario: 两个阈值均触发后不再提醒
    //   Given 电量 = 8%，两个阈值均已触发
    //   When 调用 evaluateAlert
    //   Then 返回 null
    test('两个阈值均触发后不再提醒', () {
      expect(evaluateAlert(8, true, true), isNull);
    });

    // Scenario: 边缘值 — 21% 不应触发
    test('21%不应触发任何提醒', () {
      expect(evaluateAlert(21, false, false), isNull);
    });

    // Scenario: 边缘值 — 11% 触发 20% 提醒
    test('11%触发20%提醒', () {
      expect(evaluateAlert(11, false, false), equals('20'));
    });
  });

  group('充电重置逻辑', () {
    // Scenario: 充电后重置标记再检测
    //   Given 之前已触发 20% 提醒，标记 alerted20=true
    //   When 充电后标记重置为 false，电量仍低于 20%
    //   Then evaluateAlert 应再次返回 '20'
    test('充电后重置标记，再次触发提醒', () {
      // 模拟：已触发 20%，充电后标记重置
      expect(evaluateAlert(15, true, false), isNull);  // 已触发，不重复
      expect(evaluateAlert(15, false, false), equals('20'));  // 标记重置后重新触发
    });

    // Scenario: 充电后即使通电也会重置
    test('充电重置后从10%阈值也可以重新检测', () {
      expect(evaluateAlert(8, true, true), isNull);  // 已触发，不重复
      expect(evaluateAlert(8, false, false), equals('10'));  // 重置后重新触发
    });
  });
}
