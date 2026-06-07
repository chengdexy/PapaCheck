import 'dart:io';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

/// APK 更新下载服务
///
/// 负责从服务端下载 APK 并触发安装。
/// APK 保存到应用缓存目录（而非系统临时目录），确保 Android 10+
/// 上 FileProvider 能正确生成 content URI，避免"安装包损坏"错误。
class UpdateService {
  /// 测试用：可注入的缓存目录，不为 null 时替代 [getTemporaryDirectory]
  static Directory? _testDirectory;

  /// 注入测试缓存目录（传 null 恢复生产行为）
  static void setTestDirectory(Directory? dir) {
    _testDirectory = dir;
  }

  /// 获取 APK 下载目标路径
  ///
  /// 返回应用缓存目录下的 `PapaCheck.apk` 全路径。
  /// 若父目录不存在，自动创建。
  static Future<String> getDownloadPath() async {
    final cacheDir = _testDirectory ?? await getTemporaryDirectory();
    final downloadDir = Directory(cacheDir.path);
    await downloadDir.create(recursive: true);
    return '${cacheDir.path}/PapaCheck.apk';
  }

  /// 下载 APK 并触发安装
  static Future<void> downloadAndInstall(String url) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      final filePath = await getDownloadPath();
      final file = File(filePath);
      await response.pipe(file.openWrite());
      await OpenFilex.open(file.path);
    } finally {
      client.close();
    }
  }
}
