import 'package:flutter/services.dart';

class AssetBundleLoader {
  static const Map<String, String> _cdnAssetMap = {
    'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js':
        'assets/web/js/localforage.min.js',
  };

  static final RegExp stylesheetRegex = RegExp(
    r'<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*/?>',
  );

  static final RegExp scriptSrcRegex = RegExp(
    r'<script\s+src="([^"]+)"[^>]*>\s*</script>',
  );

  static Future<String> loadAndInline(String htmlAssetPath) async {
    String html = await rootBundle.loadString(htmlAssetPath);

    html = await _inlineAssets(htmlAssetPath, html, stylesheetRegex, 'style');
    html = await _inlineAssets(htmlAssetPath, html, scriptSrcRegex, 'script');

    return html;
  }

  static Future<String> _inlineAssets(
    String htmlAssetPath,
    String html,
    RegExp regex,
    String tagName,
  ) async {
    final matches = regex.allMatches(html).toList();

    for (final match in matches) {
      final src = match.group(1)!;

      final assetPath = resolveAssetPath(htmlAssetPath, src);
      if (assetPath == null) continue;

      try {
        final content = await rootBundle.loadString(assetPath);
        String replacement;
        if (tagName == 'style') {
          replacement = '<style>$content</style>';
        } else {
          replacement = '<script>$content</script>';
        }
        html = html.replaceFirst(match.group(0)!, replacement);
      } catch (_) {}
    }

    return html;
  }

  static String? resolveAssetPath(String htmlPath, String href) {
    if (_cdnAssetMap.containsKey(href)) {
      return _cdnAssetMap[href];
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      return null;
    }

    final htmlDir = htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1);

    if (href.startsWith('/')) {
      final parts = htmlPath.split('/');
      final root = parts.sublist(0, parts.length - 1).join('/');
      return '$root$href';
    }

    return '$htmlDir$href';
  }

  static Future<String> loadRaw(String assetPath) async {
    return rootBundle.loadString(assetPath);
  }
}
