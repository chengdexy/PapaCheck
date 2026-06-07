import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/update_service.dart';

void main() {
  late Directory testCacheDir;

  setUp(() async {
    testCacheDir = await Directory.systemTemp.createTemp('update_test_');
    UpdateService.setTestDirectory(testCacheDir);
  });

  tearDown(() async {
    UpdateService.setTestDirectory(null);
    if (await testCacheDir.exists()) {
      await testCacheDir.delete(recursive: true);
    }
  });

  /// Feature: Android APK 更新下载
  ///   Scenario: 下载 APK 保存到应用缓存目录
  ///     Given 应用检测到新版本并开始下载 APK
  ///     When 获取 APK 下载路径
  ///     Then APK 应保存到指定缓存目录下，文件名为 PapaCheck.apk
  ///     And 父目录即为注入的测试缓存目录
  test('下载 APK 保存到应用缓存目录', () async {
    final path = await UpdateService.getDownloadPath();
    final file = File(path);

    expect(path, contains('PapaCheck.apk'));
    expect(file.parent.path, equals(testCacheDir.path));
  });

  /// Feature: Android APK 更新下载
  ///   Scenario: 已存在的缓存目录下返回正确路径
  ///     Given 应用缓存目录已存在
  ///     When 获取 APK 下载路径
  ///     Then 返回的路径以 PapaCheck.apk 结尾
  test('已存在的缓存目录下返回正确路径', () async {
    final path = await UpdateService.getDownloadPath();

    expect(path, contains('PapaCheck.apk'));
    expect(File(path).parent.path, equals(testCacheDir.path));
  });

  /// Feature: Android APK 更新下载
  ///   Scenario: 注入深层不存在路径时自动创建父目录
  ///     Given 使用 setTestDirectory 注入一个深层不存在路径
  ///     When 获取 APK 下载路径
  ///     Then 父目录被自动创建，路径以 PapaCheck.apk 结尾
  test('注入深层不存在路径时自动创建父目录', () async {
    final subDir = await Directory.systemTemp.createTemp('auto_create_test_');
    final deepPath = '${subDir.path}/deep/nested/dir';
    UpdateService.setTestDirectory(Directory(deepPath));

    final path = await UpdateService.getDownloadPath();
    final file = File(path);

    expect(await file.parent.exists(), isTrue);
    expect(path, contains('deep/nested/dir'));
    expect(path, contains('PapaCheck.apk'));
  });
}
