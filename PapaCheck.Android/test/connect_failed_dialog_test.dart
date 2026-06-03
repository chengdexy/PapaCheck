import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/widgets/connect_failed_dialog.dart';

void main() {
  /// Feature: 连接失败对话框
  ///   Scenario: 点击离线运行按钮返回离线结果
  ///     Given 连接失败对话框已显示
  ///     When 用户点击"离线运行"按钮
  ///     Then 对话框返回 'offline' 作为结果
  testWidgets('clicking offline button returns offline result', (tester) async {
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

    expect(find.text('离线运行'), findsOneWidget);

    await tester.tap(find.text('离线运行'));
    await tester.pumpAndSettle();

    expect(result, 'offline');
  });

  /// Feature: 连接失败对话框
  ///   Scenario: 对话框显示全部四个操作按钮
  ///     Given 连接失败对话框已显示
  ///     When 对话框渲染完成
  ///     Then 显示退出、重新配置、重试、离线运行四个按钮
  testWidgets('dialog displays all four action buttons', (tester) async {
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
    expect(find.text('离线运行'), findsOneWidget);
  });
}
