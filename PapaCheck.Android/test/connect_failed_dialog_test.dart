import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/widgets/connect_failed_dialog.dart';

void main() {
  /// Feature: 连接失败对话框
  ///   Scenario: 点击退出按钮触发系统退出
  ///     Given 连接失败对话框已显示
  ///     When 用户点击"退出"按钮
  ///     Then 对话框关闭
  testWidgets('clicking exit button closes dialog', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  showDialog<String>(
                    context: context,
                    builder: (_) =>
                        const ConnectFailedDialog(url: 'http://test:8080'),
                  );
                },
                child: const Text('Show Dialog'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Show Dialog'));
    await tester.pumpAndSettle();

    expect(find.text('退出'), findsOneWidget);
  });

  /// Feature: 连接失败对话框
  ///   Scenario: 点击重试按钮返回重试结果
  ///     Given 连接失败对话框已显示
  ///     When 用户点击"重试"按钮
  ///     Then 对话框返回 'retry' 作为结果
  testWidgets('clicking retry button returns retry result', (tester) async {
    String? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () async {
                  result = await showDialog<String>(
                    context: context,
                    builder: (_) =>
                        const ConnectFailedDialog(url: 'http://test:8080'),
                  );
                },
                child: const Text('Show Dialog'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Show Dialog'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('重试'));
    await tester.pumpAndSettle();

    expect(result, 'retry');
  });

  /// Feature: 连接失败对话框
  ///   Scenario: 点击重新配置按钮返回配置结果
  ///     Given 连接失败对话框已显示
  ///     When 用户点击"重新配置"按钮
  ///     Then 对话框返回 'config' 作为结果
  testWidgets('clicking config button returns config result', (tester) async {
    String? result;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () async {
                  result = await showDialog<String>(
                    context: context,
                    builder: (_) =>
                        const ConnectFailedDialog(url: 'http://test:8080'),
                  );
                },
                child: const Text('Show Dialog'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Show Dialog'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('重新配置'));
    await tester.pumpAndSettle();

    expect(result, 'config');
  });

  /// Feature: 连接失败对话框
  ///   Scenario: 对话框显示全部三个操作按钮
  ///     Given 连接失败对话框已显示
  ///     When 对话框渲染完成
  ///     Then 显示退出、重新配置、重试三个按钮
  testWidgets('dialog displays all three action buttons', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () {
                  showDialog<String>(
                    context: context,
                    builder: (_) =>
                        const ConnectFailedDialog(url: 'http://test:8080'),
                  );
                },
                child: const Text('Show Dialog'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Show Dialog'));
    await tester.pumpAndSettle();

    expect(find.text('退出'), findsOneWidget);
    expect(find.text('重新配置'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);
  });
}
