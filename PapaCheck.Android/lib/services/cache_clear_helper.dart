import 'package:papacheck_android/services/config_service.dart';

/// 判断是否需要清理缓存。
///
/// 决策逻辑：
/// - 首次安装（无记录版本号）：返回 false
/// - 版本号一致（未更新）：返回 false
/// - 版本号不一致（已更新）：返回 true
Future<bool> shouldClearCache(String currentVersion) async {
  final lastVersion = await ConfigService.getLastVersion();

  if (lastVersion == null) {
    return false;
  }

  if (lastVersion == currentVersion) {
    return false;
  }

  return true;
}
