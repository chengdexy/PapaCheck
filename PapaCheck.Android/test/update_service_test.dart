import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck/services/update_service.dart';

/// 启动一个本地 HTTP 服务器，提供指定大小的随机字节响应
Future<HttpServer> _startTestServer({int contentLength = 1024}) async {
  final server = await HttpServer.bind('127.0.0.1', 0);
  server.listen((request) {
    final body = utf8.encode('x' * contentLength);
    request.response
      ..contentLength = body.length
      ..headers.contentType = ContentType('application', 'vnd.android.package-archive')
      ..add(body)
      ..close();
  });
  return server;
}

/// 获取本地测试服务器的 URL
String _serverUrl(HttpServer server) {
  return 'http://127.0.0.1:${server.port}';
}

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

  // ===== 下载进度回调 =====

  /// Feature: Android APK 下载进度回调
  ///   Scenario: 下载过程中 onProgress 回调返回正确进度
  ///     Given 开始下载 APK
  ///     When 下载进行中
  ///     Then onProgress 回调被调用，进度值从 0 增长到 1.0
  test('下载过程中 onProgress 回调返回正确进度', () async {
    const testContentLength = 65536; // 64KB
    final server = await _startTestServer(contentLength: testContentLength);
    final url = _serverUrl(server);

    final List<double> progressValues = [];
    try {
      await UpdateService.downloadAndInstall(
        url,
        onProgress: (p) {
          progressValues.add(p);
        },
      );
    } finally {
      await server.close(force: true);
    }

    // 验证 onProgress 被调用过
    expect(progressValues, isNotEmpty);
    // 验证第一个进度值 > 0（不是从 0 开始也能接受）
    expect(progressValues.first, greaterThan(0));
    // 验证最终进度为 1.0
    expect(progressValues.last, closeTo(1.0, 0.01));
    // 验证进度值单调递增
    for (int i = 1; i < progressValues.length; i++) {
      expect(progressValues[i], greaterThanOrEqualTo(progressValues[i - 1]));
    }
    // 验证 APK 文件已保存到缓存目录
    final file = File(await UpdateService.getDownloadPath());
    expect(await file.exists(), isTrue);
    expect(await file.length(), equals(testContentLength));
  });

  /// Feature: Android APK 下载进度回调
  ///   Scenario: 不传 onProgress 时 downloadAndInstall 原有行为不变
  ///     Given 调用 downloadAndInstall 时不传 onProgress 参数
  ///     When 下载完成
  ///     Then APK 仍然正常保存并触发安装（不会因缺少回调而崩溃）
  test('不传 onProgress 时下载行为不变', () async {
    const testContentLength = 4096;
    final server = await _startTestServer(contentLength: testContentLength);
    final url = _serverUrl(server);

    try {
      await UpdateService.downloadAndInstall(url);
    } finally {
      await server.close(force: true);
    }

    // 验证文件正常保存（不传 onProgress 不会崩溃或挂起）
    final file = File(await UpdateService.getDownloadPath());
    expect(await file.exists(), isTrue);
    expect(await file.length(), equals(testContentLength));
  });
}
