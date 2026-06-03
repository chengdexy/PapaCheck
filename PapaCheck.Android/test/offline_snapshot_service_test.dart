import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/offline_snapshot_service.dart';

void main() {
  late Directory testDir;

  setUp(() async {
    testDir = await Directory.systemTemp.createTemp('offline_snapshot_test_');
    OfflineSnapshotService.setTestDirectory(testDir);
  });

  tearDown(() async {
    OfflineSnapshotService.setTestDirectory(null);
    if (await testDir.exists()) {
      await testDir.delete(recursive: true);
    }
  });

  /// Feature: 离线快照持久化存储
  ///   Scenario: 保存快照后应用重启可以完整加载
  ///     Given 应用将内联HTML快照保存到文件系统
  ///     When 应用重启后尝试加载该快照
  ///     Then 快照内容完整返回，与保存时一致
  test('保存快照后应用重启可以完整加载', () async {
    const url = 'http://192.168.1.100:8080/index.html';
    const html =
        '<html><head><style>body{color:red}</style></head><body>Hello</body></html>';

    await OfflineSnapshotService.save(url, html);
    final loaded = await OfflineSnapshotService.load(url);

    expect(loaded, equals(html));
  });

  /// Feature: 离线快照持久化存储
  ///   Scenario: 大体积HTML快照（含内联CSS和JS）可可靠存储和读取
  ///     Given 一个包含大量内联CSS和JS内容的HTML快照（超过100KB）
  ///     When 将该快照保存后再加载
  ///     Then 加载的内容与原始内容完全一致
  test('大体积HTML快照可可靠存储和读取', () async {
    const url = 'http://192.168.1.100:8080/index.html';
    // 生成超过100KB的HTML内容
    final largeCss = 'body{color:red;}' * 5000; // ~100KB
    final largeJs = 'console.log("test");' * 3000; // ~60KB
    final html = '<html><head><style>$largeCss</style></head>'
        '<body><script>$largeJs</script></body></html>';

    await OfflineSnapshotService.save(url, html);
    final loaded = await OfflineSnapshotService.load(url);

    expect(loaded, equals(html));
  });

  /// Feature: 离线快照持久化存储
  ///   Scenario: 未保存过快照时加载返回null
  ///     Given 从未为某个URL保存过快照
  ///     When 尝试加载该URL的快照
  ///     Then 返回null
  test('未保存过快照时加载返回null', () async {
    const url = 'http://192.168.1.100:8080/index.html';

    final loaded = await OfflineSnapshotService.load(url);

    expect(loaded, isNull);
  });

  /// Feature: 离线快照持久化存储
  ///   Scenario: 保存快照后覆盖更新
  ///     Given 已存在某个URL的快照
  ///     When 保存新的快照内容到同一URL
  ///     Then 加载返回最新的快照内容
  test('保存快照后覆盖更新', () async {
    const url = 'http://192.168.1.100:8080/index.html';

    await OfflineSnapshotService.save(url, '<html>old</html>');
    await OfflineSnapshotService.save(url, '<html>new</html>');
    final loaded = await OfflineSnapshotService.load(url);

    expect(loaded, equals('<html>new</html>'));
  });
}
