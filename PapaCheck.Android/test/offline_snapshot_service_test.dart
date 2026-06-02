import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:papacheck_android/services/offline_snapshot_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('save and load offline snapshot by url', () async {
    const url = 'http://192.168.1.100:8080/';
    const html = '<html><body>test child page</body></html>';

    await OfflineSnapshotService.save(url, html);
    final result = await OfflineSnapshotService.load(url);

    expect(result, html);
  });

  test('load returns null when no snapshot saved', () async {
    const url = 'http://192.168.1.100:8080/admin.html';

    final result = await OfflineSnapshotService.load(url);

    expect(result, isNull);
  });

  test('save overwrites previous snapshot', () async {
    const url = 'http://192.168.1.100:8080/';

    await OfflineSnapshotService.save(url, '<html>old</html>');
    await OfflineSnapshotService.save(url, '<html>new</html>');
    final result = await OfflineSnapshotService.load(url);

    expect(result, '<html>new</html>');
  });

  test('different urls store separate snapshots', () async {
    const childUrl = 'http://192.168.1.100:8080/';
    const parentUrl = 'http://192.168.1.100:8080/admin.html';

    await OfflineSnapshotService.save(childUrl, '<html>child</html>');
    await OfflineSnapshotService.save(parentUrl, '<html>parent</html>');

    expect(await OfflineSnapshotService.load(childUrl), '<html>child</html>');
    expect(await OfflineSnapshotService.load(parentUrl), '<html>parent</html>');
  });
}
