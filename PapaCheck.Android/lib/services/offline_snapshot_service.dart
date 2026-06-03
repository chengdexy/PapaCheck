import 'package:shared_preferences/shared_preferences.dart';

const String _keyPrefix = 'offline_snapshot_';

class OfflineSnapshotService {
  static Future<void> save(String url, String html) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyPrefix + url, html);
  }

  static Future<String?> load(String url) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyPrefix + url);
  }
}
