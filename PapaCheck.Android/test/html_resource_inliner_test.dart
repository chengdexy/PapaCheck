import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/html_resource_inliner.dart';

void main() {
  test('inlines stylesheet link tags', () async {
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

  test('inlines script src tags', () async {
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

  test('resolves relative and absolute urls', () async {
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

  test('skips resource on fetch failure', () async {
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

  test('leaves non-stylesheet link tags untouched', () async {
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

  test('leaves inline script tags untouched', () async {
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
