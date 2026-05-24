import 'package:shared_preferences/shared_preferences.dart';

const String _keyUrl = 'child_web_url';
const String _keyRole = 'device_role';

enum DeviceRole { child, parent }

class ConfigService {
  static Future<String?> getUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyUrl);
  }

  static Future<void> setUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyUrl, url);
  }

  static Future<DeviceRole?> getRole() async {
    final prefs = await SharedPreferences.getInstance();
    final v = prefs.getString(_keyRole);
    if (v == 'parent') return DeviceRole.parent;
    if (v == 'child') return DeviceRole.child;
    return null;
  }

  static Future<void> setRole(DeviceRole role) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _keyRole,
      role == DeviceRole.parent ? 'parent' : 'child',
    );
  }
}
