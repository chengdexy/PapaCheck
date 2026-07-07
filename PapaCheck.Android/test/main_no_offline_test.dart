import 'package:flutter_test/flutter_test.dart';
import 'dart:io';

void main() {
  group('离线模块已删除', () {
    test('OfflineSnapshotService 文件不存在', () {
      final file = File('lib/services/offline_snapshot_service.dart');
      expect(file.existsSync(), isFalse,
        reason: 'offline_snapshot_service.dart 应已删除');
    });

    test('CacheClearHelper 文件不存在', () {
      final file = File('lib/services/cache_clear_helper.dart');
      expect(file.existsSync(), isFalse,
        reason: 'cache_clear_helper.dart 应已删除');
    });

    test('main.dart 不导入离线模块', () {
      final mainFile = File('lib/main.dart');
      final content = mainFile.readAsStringSync();
      expect(content.contains('offline_snapshot_service'), isFalse,
        reason: 'main.dart 不应导入 offline_snapshot_service');
      expect(content.contains('cache_clear_helper'), isFalse,
        reason: 'main.dart 不应导入 cache_clear_helper');
      expect(content.contains('_queueChannel'), isFalse,
        reason: 'main.dart 不应包含 _queueChannel 写队列桥接');
    });
  });
}
