import 'package:shared_preferences/shared_preferences.dart';

const String _keyUrl = 'child_web_url';

class ConfigService {
  static Future<String?> getUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyUrl);
  }

  static Future<void> setUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyUrl, url);
  }
}
