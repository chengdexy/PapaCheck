import 'package:shared_preferences/shared_preferences.dart';

const String _keyUrl = 'child_web_url';
const String _keyRole = 'device_role';
const String _keyVersion = 'last_version';
const String _keyAuthToken = 'auth_token';
const String _keyAuthRole = 'auth_role';
const String _keyAuthChildName = 'auth_child_name';

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

  static Future<void> setLastVersion(String version) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyVersion, version);
  }

  static Future<String?> getLastVersion() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyVersion);
  }

  // ========== Auth token persistence (Android WebView session restore) ==========

  static Future<void> setAuthData({
    required String token,
    String role = '',
    String childName = '',
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyAuthToken, token);
    await prefs.setString(_keyAuthRole, role);
    await prefs.setString(_keyAuthChildName, childName);
  }

  static Future<String?> getAuthToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyAuthToken);
  }

  static Future<String?> getAuthRole() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyAuthRole);
  }

  static Future<String?> getAuthChildName() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyAuthChildName);
  }

  static Future<void> clearAuth() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyAuthToken);
    await prefs.remove(_keyAuthRole);
    await prefs.remove(_keyAuthChildName);
  }
}
