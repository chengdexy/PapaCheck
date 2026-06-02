import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/widgets/connect_failed_dialog.dart';

void main() {
  testWidgets('ConnectFailedDialog shows offline run button and returns offline',
      (tester) async {
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

  testWidgets(
      'ConnectFailedDialog shows all buttons: exit, config, retry, offline',
      (tester) async {
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
