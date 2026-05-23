import 'package:flutter_test/flutter_test.dart';

import 'package:papacheck_android/main.dart';

void main() {
  testWidgets('PapaCheck Android smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const PapaCheckBrowser());
    expect(find.byType(PapaCheckBrowser), findsOneWidget);
  });
}