import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/asset_bundle_loader.dart';

void main() {
  group('AssetBundleLoader.resolveAssetPath', () {
    /// Feature: 资源路径解析
    ///   Scenario: 相对路径基于 HTML 文件位置解析
    ///     Given HTML 文件位于 'assets/web/admin.html'，CSS 相对路径为 'css/admin.css'
    ///     When 解析资源路径
    ///     Then 结果为 'assets/web/css/admin.css'
    test('resolves relative CSS path relative to HTML file', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        'css/admin.css',
      );
      expect(result, 'assets/web/css/admin.css');
    });

    /// Feature: 资源路径解析
    ///   Scenario: 绝对路径基于 Web 根目录解析
    ///     Given HTML 文件位于 'assets/web/admin.html'，CSS 绝对路径为 '/css/admin.css'
    ///     When 解析资源路径
    ///     Then 结果为 'assets/web/css/admin.css'
    test('resolves absolute CSS path relative to web root', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        '/css/admin.css',
      );
      expect(result, 'assets/web/css/admin.css');
    });

    /// Feature: 资源路径解析
    ///   Scenario: HTTPS URL 不解析为本地路径
    ///     Given HTML 文件位于 'assets/web/admin.html'，资源为 HTTPS URL
    ///     When 解析资源路径
    ///     Then 返回 null
    test('returns null for HTTPS URL', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        'https://cdn.jsdelivr.net/npm/localforage/dist/localforage.min.js',
      );
      expect(result, isNull);
    });

    /// Feature: 资源路径解析
    ///   Scenario: HTTP URL 不解析为本地路径
    ///     Given HTML 文件位于 'assets/web/admin.html'，资源为 HTTP URL
    ///     When 解析资源路径
    ///     Then 返回 null
    test('returns null for HTTP URL', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        'http://example.com/script.js',
      );
      expect(result, isNull);
    });
  });

  group('AssetBundleLoader regex matching', () {
    /// Feature: 样式表正则匹配
    ///   Scenario: 从 link 标签提取 href 属性值
    ///     Given 包含 href 属性的 stylesheet link 标签
    ///     When 应用样式表正则匹配
    ///     Then 提取出 href 值 'css/admin.css'
    test('extracts href from stylesheet link tag', () {
      final match = AssetBundleLoader.stylesheetRegex
          .firstMatch('<link rel="stylesheet" href="css/admin.css">');
      expect(match, isNotNull);
      expect(match!.group(1), 'css/admin.css');
    });

    /// Feature: 脚本正则匹配
    ///   Scenario: 从 script 标签提取 src 属性值
    ///     Given 包含 src 属性的 script 标签
    ///     When 应用脚本正则匹配
    ///     Then 提取出 src 值 'js/api.js'
    test('extracts src from script tag', () {
      final match = AssetBundleLoader.scriptSrcRegex
          .firstMatch('<script src="js/api.js"></script>');
      expect(match, isNotNull);
      expect(match!.group(1), 'js/api.js');
    });
  });
}
