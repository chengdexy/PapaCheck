import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/asset_bundle_loader.dart';

void main() {
  /// Feature: APK资源内联支持本地CDN资源
  ///   Scenario: CDN脚本引用被替换为APK内嵌的本地副本
  ///     Given HTML文档中包含CDN上的localforage脚本引用
  ///       And APK assets中包含localforage.min.js的本地副本
  ///     When 从APK assets加载并内联资源
  ///     Then CDN脚本标签被替换为包含localforage内容的内联script元素
  test('CDN脚本引用被替换为APK内嵌的本地副本', () {
    const cdnUrl =
        'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js';

    final result = AssetBundleLoader.resolveAssetPath(
      'assets/web/index.html',
      cdnUrl,
    );

    expect(result, equals('assets/web/js/localforage.min.js'));
  });

  /// Feature: APK资源内联支持本地CDN资源
  ///   Scenario: 无本地副本的CDN资源保持原始标签不变
  ///     Given HTML文档中包含CDN上的脚本引用
  ///       And APK assets中不包含该脚本的本地副本
  ///     When 从APK assets加载并内联资源
  ///     Then 原始CDN脚本标签保持不变
  test('无本地副本的CDN资源保持原始标签不变', () {
    const unknownCdnUrl = 'https://cdn.example.com/unknown-lib.js';

    final result = AssetBundleLoader.resolveAssetPath(
      'assets/web/index.html',
      unknownCdnUrl,
    );

    expect(result, isNull);
  });

  /// Feature: APK资源路径解析
  ///   Scenario: 用HTML文件路径解析相对CSS路径
  ///     Given HTML文件路径为 assets/web/index.html
  ///       And CSS引用为 css/style.css
  ///     When 解析资源路径
  ///     Then 返回 assets/web/css/style.css
  test('用HTML文件路径解析相对CSS路径', () {
    final result = AssetBundleLoader.resolveAssetPath(
      'assets/web/index.html',
      'css/style.css',
    );

    expect(result, equals('assets/web/css/style.css'));
  });

  /// Feature: APK资源路径解析
  ///   Scenario: 用HTML文件路径解析相对JS路径
  ///     Given HTML文件路径为 assets/web/index.html
  ///       And JS引用为 js/app.js
  ///     When 解析资源路径
  ///     Then 返回 assets/web/js/app.js
  test('用HTML文件路径解析相对JS路径', () {
    final result = AssetBundleLoader.resolveAssetPath(
      'assets/web/index.html',
      'js/app.js',
    );

    expect(result, equals('assets/web/js/app.js'));
  });

  /// Feature: APK资源路径解析
  ///   Scenario: 用HTML文件路径解析绝对路径资源
  ///     Given HTML文件路径为 assets/web/admin.html
  ///       And 资源引用为 /css/admin.css
  ///     When 解析资源路径
  ///     Then 返回 assets/web/css/admin.css
  test('用HTML文件路径解析绝对路径资源', () {
    final result = AssetBundleLoader.resolveAssetPath(
      'assets/web/admin.html',
      '/css/admin.css',
    );

    expect(result, equals('assets/web/css/admin.css'));
  });

  /// Feature: APK资源路径解析
  ///   Scenario: 用HTML内容字符串解析相对路径会得到错误结果
  ///     Given 传入的是HTML内容字符串而非文件路径
  ///       And CSS引用为 css/style.css
  ///     When 解析资源路径
  ///     Then 结果不等于正确的assets路径
  test('用HTML内容字符串解析相对路径会得到错误结果', () {
    const htmlContent =
        '<html><head><link rel="stylesheet" href="css/style.css"></head><body></body></html>';

    final result = AssetBundleLoader.resolveAssetPath(
      htmlContent,
      'css/style.css',
    );

    // 用HTML内容作为htmlPath会产生垃圾路径，不等于正确的assets路径
    expect(result, isNot(equals('assets/web/css/style.css')));
  });
}
