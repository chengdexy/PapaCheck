import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:papacheck_android/services/offline_snapshot_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  /// Feature: 离线快照存储
  ///   Scenario: 保存后可通过相同 URL 加载快照
  ///     Given 已为某 URL 保存离线快照
  ///     When 通过相同 URL 加载快照
  ///     Then 返回已保存的 HTML 内容
  test('saved snapshot can be loaded by same URL', () async {
    const url = 'http://192.168.1.100:8080/';
    const html = '<html><body>test child page</body></html>';

    await OfflineSnapshotService.save(url, html);
    final result = await OfflineSnapshotService.load(url);

    expect(result, html);
  });

  /// Feature: 离线快照存储
  ///   Scenario: 未保存快照的 URL 加载时返回 null
  ///     Given 未为某 URL 保存过离线快照
  ///     When 通过该 URL 加载快照
  ///     Then 返回 null
  test('loading unsaved URL returns null', () async {
    const url = 'http://192.168.1.100:8080/admin.html';

    final result = await OfflineSnapshotService.load(url);

    expect(result, isNull);
  });

  /// Feature: 离线快照存储
  ///   Scenario: 同一 URL 重复保存覆盖旧快照
  ///     Given 已为某 URL 保存离线快照
  ///     When 再次为同一 URL 保存新快照
  ///     Then 旧快照被新内容覆盖
  test('saving twice overwrites previous snapshot', () async {
    const url = 'http://192.168.1.100:8080/';

    await OfflineSnapshotService.save(url, '<html>old</html>');
    await OfflineSnapshotService.save(url, '<html>new</html>');
    final result = await OfflineSnapshotService.load(url);

    expect(result, '<html>new</html>');
  });

  /// Feature: 离线快照存储
  ///   Scenario: 不同 URL 的快照相互隔离
  ///     Given 已为两个不同 URL 分别保存快照
  ///     When 分别通过各自 URL 加载快照
  ///     Then 每个 URL 返回各自独立的快照内容
  test('different URLs maintain separate snapshots', () async {
    const childUrl = 'http://192.168.1.100:8080/';
    const parentUrl = 'http://192.168.1.100:8080/admin.html';

    await OfflineSnapshotService.save(childUrl, '<html>child</html>');
    await OfflineSnapshotService.save(parentUrl, '<html>parent</html>');

    expect(await OfflineSnapshotService.load(childUrl), '<html>child</html>');
    expect(await OfflineSnapshotService.load(parentUrl), '<html>parent</html>');
  });
}
