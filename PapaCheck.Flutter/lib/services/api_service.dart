import 'package:dio/dio.dart';

/// API 客户端（对应 web 端 api.js）
class ApiService {
  late final Dio _dio;
  String _baseUrl = 'http://localhost:8080';

  bool _isServerMode = false;
  bool get isServerMode => _isServerMode;

  static final ApiService _instance = ApiService._();
  factory ApiService() => _instance;
  ApiService._() {
    _dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 10),
        headers: {'Content-Type': 'application/json'},
      ),
    );
  }

  /// 设置服务器地址（Android 首次配置时调用）
  Future<void> setBaseUrl(String host) async {
    _baseUrl = 'http://$host:8080';
    _isServerMode = false;
  }

  String get baseUrl => _baseUrl;

  Future<dynamic> _fetch(
    String path, {
    String method = 'GET',
    dynamic body,
  }) async {
    try {
      final url = '$_baseUrl$path';
      final response = await _dio.request(
        url,
        data: body,
        options: Options(method: method),
      );
      _isServerMode = true;
      if (response.data is Map || response.data is List) {
        return response.data;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// GET /api/data — 全量数据
  Future<Map<String, dynamic>?> getData() async {
    final result = await _fetch('/api/data');
    if (result is Map<String, dynamic>) {
      _isServerMode = true;
      return result;
    }
    return null;
  }

  /// GET /api/homeworks/{date}
  Future<List<dynamic>?> getHomeworks(String dateKey) async {
    final result = await _fetch('/api/homeworks/$dateKey');
    return result is List ? result : null;
  }

  /// POST /api/homeworks/{date}
  Future<bool> saveHomeworks(
    String dateKey,
    List<Map<String, dynamic>> list,
  ) async {
    await _fetch(
      '/api/homeworks/$dateKey',
      method: 'POST',
      body: {'homeworks': list},
    );
    return true;
  }

  /// GET /api/settlement/{date}
  Future<Map<String, dynamic>?> getSettlement(String dateKey) async {
    final result = await _fetch('/api/settlement/$dateKey');
    return result is Map<String, dynamic> ? result : null;
  }

  /// POST /api/settlement/{date}
  Future<bool> saveSettlement(String dateKey, Map<String, dynamic> data) async {
    await _fetch(
      '/api/settlement/$dateKey',
      method: 'POST',
      body: {'settlement': data},
    );
    return true;
  }

  /// POST /api/points
  Future<int?> updatePoints(String action, int amount, String detail) async {
    final result = await _fetch(
      '/api/points',
      method: 'POST',
      body: {'action': action, 'amount': amount, 'detail': detail},
    );
    if (result is Map) return result['balance'];
    return null;
  }

  /// GET /api/shop
  Future<List<dynamic>?> getShopItems() async {
    final result = await _fetch('/api/shop');
    return result is List ? result : null;
  }

  /// POST /api/shop
  Future<bool> saveShopItems(List<Map<String, dynamic>> items) async {
    await _fetch('/api/shop', method: 'POST', body: {'items': items});
    return true;
  }

  /// GET /api/settings
  Future<Map<String, dynamic>?> getSettings() async {
    final result = await _fetch('/api/settings');
    return result is Map<String, dynamic> ? result : null;
  }

  /// POST /api/settings
  Future<bool> saveSettings(Map<String, dynamic> settings) async {
    await _fetch('/api/settings', method: 'POST', body: {'settings': settings});
    return true;
  }

  /// GET /api/redemptions
  Future<List<dynamic>?> getRedemptions() async {
    final result = await _fetch('/api/redemptions');
    return result is List ? result : null;
  }

  /// POST /api/redemptions
  Future<bool> saveRedemptions(List<Map<String, dynamic>> list) async {
    await _fetch(
      '/api/redemptions',
      method: 'POST',
      body: {'redemptions': list},
    );
    return true;
  }

  /// GET /api/reward-box
  Future<List<dynamic>?> getRewardBox() async {
    final result = await _fetch('/api/reward-box');
    return result is List ? result : null;
  }

  /// POST /api/reward-box
  Future<bool> saveRewardBox(List<Map<String, dynamic>> items) async {
    await _fetch('/api/reward-box', method: 'POST', body: {'items': items});
    return true;
  }

  /// GET /api/active-buffs
  Future<List<dynamic>?> getActiveBuffs() async {
    final result = await _fetch('/api/active-buffs');
    return result is List ? result : null;
  }

  /// POST /api/active-buffs
  Future<bool> saveActiveBuffs(List<Map<String, dynamic>> buffs) async {
    await _fetch('/api/active-buffs', method: 'POST', body: {'buffs': buffs});
    return true;
  }

  /// GET /api/efficiency/{date}
  Future<Map<String, dynamic>?> getEfficiency(String dateKey) async {
    final result = await _fetch('/api/efficiency/$dateKey');
    return result is Map<String, dynamic> ? result : null;
  }

  /// POST /api/efficiency/{date}
  Future<bool> saveEfficiency(String dateKey, Map<String, dynamic> data) async {
    await _fetch(
      '/api/efficiency/$dateKey',
      method: 'POST',
      body: {'efficiency': data},
    );
    return true;
  }

  /// GET /api/freetime/{date}
  Future<List<dynamic>?> getFreeTime(String dateKey) async {
    final result = await _fetch('/api/freetime/$dateKey');
    return result is List ? result : null;
  }

  /// POST /api/freetime/{date}
  Future<bool> saveFreeTime(
    String dateKey,
    List<Map<String, dynamic>> tasks,
  ) async {
    await _fetch(
      '/api/freetime/$dateKey',
      method: 'POST',
      body: {'tasks': tasks},
    );
    return true;
  }

  /// POST /api/defer-homework
  Future<dynamic> deferHomework(
    String dateKey,
    String hwId,
    String action, {
    String? requestedAt,
  }) async {
    return await _fetch(
      '/api/defer-homework',
      method: 'POST',
      body: {
        'date': dateKey,
        'hwId': hwId,
        'action': action,
        'requestedAt': requestedAt,
      },
    );
  }

  /// GET /api/speak?text=...
  String getSpeechUrl(String text) {
    return '$_baseUrl/api/speak?text=${Uri.encodeComponent(text)}';
  }
}
