import 'package:flutter_test/flutter_test.dart';

import 'package:papacheck_browser/main.dart';

void main() {
  testWidgets('PapaCheck Browser smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const PapaCheckBrowser());
    expect(find.byType(PapaCheckBrowser), findsOneWidget);
  });
}
