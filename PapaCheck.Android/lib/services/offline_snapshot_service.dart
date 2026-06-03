import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

class OfflineSnapshotService {
  static Directory? _testDir;

  @visibleForTesting
  static void setTestDirectory(Directory? dir) => _testDir = dir;

  static Future<Directory> _getDir() async {
    if (_testDir != null) return _testDir!;
    return await getApplicationSupportDirectory();
  }

  static String _sanitizeKey(String url) {
    return url.replaceAll(RegExp(r'[^\w]'), '_');
  }

  static Future<void> save(String url, String html) async {
    final dir = await _getDir();
    final file = File('${dir.path}/offline_snapshot_${_sanitizeKey(url)}.html');
    await file.writeAsString(html);
  }

  static Future<String?> load(String url) async {
    final dir = await _getDir();
    final file = File('${dir.path}/offline_snapshot_${_sanitizeKey(url)}.html');
    if (await file.exists()) {
      return file.readAsString();
    }
    return null;
  }
}
