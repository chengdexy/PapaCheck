import 'package:flutter/services.dart';

class AssetBundleLoader {
  static final RegExp stylesheetRegex = RegExp(
    r'<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*/?>',
  );

  static final RegExp scriptSrcRegex = RegExp(
    r'<script\s+src="([^"]+)"[^>]*>\s*</script>',
  );

  static Future<String> loadAndInline(String htmlAssetPath) async {
    String html = await rootBundle.loadString(htmlAssetPath);

    html = await _inlineAssets(html, stylesheetRegex, 'style');
    html = await _inlineAssets(html, scriptSrcRegex, 'script');

    return html;
  }

  static Future<String> _inlineAssets(
    String html,
    RegExp regex,
    String tagName,
  ) async {
    final matches = regex.allMatches(html).toList();

    for (final match in matches) {
      final src = match.group(1)!;

      final assetPath = resolveAssetPath(html, src);
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
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return null;
    }

    final htmlDir = htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1);

    if (href.startsWith('/')) {
      final parts = htmlPath.split('/');
      final root = parts.sublist(0, parts.length - 1).join('/');
      return '$root${href}';
    }

    return '$htmlDir$href';
  }

  static Future<String> loadRaw(String assetPath) async {
    return rootBundle.loadString(assetPath);
  }
}
