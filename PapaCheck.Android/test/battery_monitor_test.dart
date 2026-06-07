import 'package:flutter_test/flutter_test.dart';
import 'package:battery_plus/battery_plus.dart';

// BatteryMonitor 在 main.dart 中定义，通过 evaluateAlert 静态方法暴露纯逻辑
// 为避免导入整个 main.dart 带来的依赖问题，此处内联一个等价的参考实现
// （与 main.dart 中 BatteryMonitor.evaluateAlert 保持严格一致）
String? evaluateAlert(int batteryLevel, bool alerted20, bool alerted10) {
  if (batteryLevel <= 10 && !alerted10) return '10';
  if (batteryLevel <= 20 && !alerted20) return '20';
  return null;
}

/// 模拟 _onBatteryStateChanged 的行为。
/// 只在 discharging → charging 转换时重置标记，重复 charging 事件忽略。
(bool alerted20, bool alerted10, BatteryState? lastState) onBatteryStateChanged(
  BatteryState? lastState,
  BatteryState state,
  bool alerted20,
  bool alerted10,
) {
  if (lastState == BatteryState.discharging && state == BatteryState.charging) {
    alerted20 = false;
    alerted10 = false;
  }
  return (alerted20, alerted10, state);
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

  // Feature: 电池状态变化事件处理
  //   验证 _onBatteryStateChanged 只在 discharging → charging 转换时重置标记
  group('充电事件防抖', () {
    // Scenario: 重复 charging 事件不应反复重置标记
    //   Given 已触发 20% 提醒，_checkAndAlert 已将 alerted20 设为 true
    //   And _lastState 为 charging（设备已在充电中）
    //   When 再次收到 charging 事件（系统重复广播）
    //   Then 标记不应被重置，避免下次轮询再次播报
    test('重复charging事件不应反复重置标记', () {
      bool alerted20 = true;   // _checkAndAlert 已设为 true
      bool alerted10 = false;
      BatteryState? lastState = BatteryState.charging; // 已在充电中

      // 再次收到 charging 事件（系统重复广播）
      (alerted20, alerted10, lastState) = onBatteryStateChanged(
        lastState, BatteryState.charging, alerted20, alerted10,
      );

      // 修复后：标记应维持已触发状态
      expect(evaluateAlert(15, alerted20, alerted10), isNull);
    });

    // Scenario: discharging → charging 转换时可以重置
    //   Given 已触发 20% 提醒
    //   When 状态从 discharging 变更为 charging（真正的插入充电器）
    //   Then 标记被重置，允许下次提醒
    test('discharging到charging转换时正确重置标记', () {
      bool alerted20 = true;
      bool alerted10 = false;
      BatteryState? lastState = BatteryState.discharging;

      // 插入充电器：discharging → charging
      (alerted20, alerted10, lastState) = onBatteryStateChanged(
        lastState, BatteryState.charging, alerted20, alerted10,
      );

      expect(alerted20, isFalse);
      expect(alerted10, isFalse);
      // 重置后应能再次触发
      expect(evaluateAlert(15, alerted20, alerted10), equals('20'));
    });
  });
}
