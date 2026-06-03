import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/html_resource_inliner.dart';

void main() {
  /// Feature: HTML 资源内联
  ///   Scenario: 样式表 link 标签替换为内联 style 元素
  ///     Given HTML 文档中包含 stylesheet link 标签
  ///     When 执行资源内联
  ///     Then link 标签被替换为包含 CSS 内容的内联 style 元素
  test('replaces stylesheet link tag with inline style', () async {
    const html = '<html><head>'
        '<link rel="stylesheet" href="css/style.css">'
        '</head><body></body></html>';

    final result = await HtmlResourceInliner.inlineResources(
      html,
      'http://host:8080/',
      (url) async {
        if (url == 'http://host:8080/css/style.css') return 'body{color:red}';
        throw Exception('unexpected: $url');
      },
    );

    expect(result, contains('<style>body{color:red}</style>'));
    expect(result, isNot(contains('href="css/style.css"')));
  });

  /// Feature: HTML 资源内联
  ///   Scenario: 脚本 src 标签替换为内联 script 元素
  ///     Given HTML 文档中包含 script src 标签
  ///     When 执行资源内联
  ///     Then script 标签被替换为包含 JS 内容的内联 script 元素
  test('replaces script src tag with inline script', () async {
    const html = '<html><head></head><body>'
        '<script src="js/app.js"></script>'
        '</body></html>';

    final result = await HtmlResourceInliner.inlineResources(
      html,
      'http://host:8080/',
      (url) async {
        if (url == 'http://host:8080/js/app.js') return 'console.log("hi")';
        throw Exception('unexpected: $url');
      },
    );

    expect(result, contains('<script>console.log("hi")</script>'));
    expect(result, isNot(contains('src="js/app.js"')));
  });

  /// Feature: HTML 资源内联
  ///   Scenario: 相对和绝对 URL 均可正确解析并内联
  ///     Given HTML 文档中同时包含相对路径和绝对路径的资源 URL
  ///     When 执行资源内联
  ///     Then 两种 URL 均被正确解析并内联
  test('resolves both relative and absolute resource URLs', () async {
    const html = '<html><head>'
        '<link rel="stylesheet" href="css/style.css">'
        '</head><body>'
        '<script src="https://cdn.example.com/lib.js"></script>'
        '</body></html>';

    final result = await HtmlResourceInliner.inlineResources(
      html,
      'http://host:8080/',
      (url) async {
        if (url == 'http://host:8080/css/style.css') return 'css{}';
        if (url == 'https://cdn.example.com/lib.js') return 'var lib=1';
        throw Exception('unexpected: $url');
      },
    );

    expect(result, contains('<style>css{}</style>'));
    expect(result, contains('<script>var lib=1</script>'));
  });

  /// Feature: HTML 资源内联
  ///   Scenario: 资源获取失败时保留原始标签
  ///     Given HTML 文档中包含样式表 link 标签且资源获取会失败
  ///     When 执行资源内联
  ///     Then 原始 link 标签在输出中保持不变
  test('keeps original tag when resource fetch fails', () async {
    const html = '<html><head>'
        '<link rel="stylesheet" href="css/missing.css">'
        '</head><body></body></html>';

    final result = await HtmlResourceInliner.inlineResources(
      html,
      'http://host:8080/',
      (url) async => throw Exception('not found'),
    );

    expect(result, contains('href="css/missing.css"'));
  });

  /// Feature: HTML 资源内联
  ///   Scenario: 非样式表 link 标签保持不变
  ///     Given HTML 文档中包含图标等非样式表 link 标签
  ///     When 执行资源内联
  ///     Then 非 stylesheet 的 link 标签保持原样
  test('preserves non-stylesheet link tags like icons', () async {
    const html = '<html><head>'
        '<link rel="icon" href="favicon.png">'
        '</head><body></body></html>';

    final result = await HtmlResourceInliner.inlineResources(
      html,
      'http://host:8080/',
      (url) async => throw Exception('should not be called'),
    );

    expect(result, contains('<link rel="icon" href="favicon.png">'));
  });

  /// Feature: HTML 资源内联
  ///   Scenario: 内联 script 标签（无 src 属性）保持不变
  ///     Given HTML 文档中包含无 src 属性的内联 script 标签
  ///     When 执行资源内联
  ///     Then 内联 script 标签保持原样
  test('preserves inline script tags without src attribute', () async {
    const html = '<html><head></head><body>'
        '<script>console.log("inline")</script>'
        '</body></html>';

    final result = await HtmlResourceInliner.inlineResources(
      html,
      'http://host:8080/',
      (url) async => throw Exception('should not be called'),
    );

    expect(result, contains('<script>console.log("inline")</script>'));
  });
}
