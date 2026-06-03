class HtmlResourceInliner {
  static final RegExp _stylesheetRegex = RegExp(
    r'<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*/?>',
  );

  static final RegExp _scriptSrcRegex = RegExp(
    r'<script\s+src="([^"]+)"[^>]*>\s*</script>',
  );

  static Future<String> inlineResources(
    String html,
    String baseUrl,
    Future<String> Function(String url) fetcher,
  ) async {
    var result = html;

    result = await _inlineStylesheets(result, baseUrl, fetcher);
    result = await _inlineScripts(result, baseUrl, fetcher);

    return result;
  }

  static Future<String> _inlineStylesheets(
    String html,
    String baseUrl,
    Future<String> Function(String url) fetcher,
  ) async {
    final matches = _stylesheetRegex.allMatches(html).toList();

    for (final match in matches) {
      final href = match.group(1)!;
      final fullUrl = _resolveUrl(href, baseUrl);

      try {
        final css = await fetcher(fullUrl);
        final replacement = '<style>$css</style>';
        html = html.replaceFirst(match.group(0)!, replacement);
      } catch (_) {}
    }

    return html;
  }

  static Future<String> _inlineScripts(
    String html,
    String baseUrl,
    Future<String> Function(String url) fetcher,
  ) async {
    final matches = _scriptSrcRegex.allMatches(html).toList();

    for (final match in matches) {
      final src = match.group(1)!;
      final fullUrl = _resolveUrl(src, baseUrl);

      try {
        final js = await fetcher(fullUrl);
        final replacement = '<script>$js</script>';
        html = html.replaceFirst(match.group(0)!, replacement);
      } catch (_) {}
    }

    return html;
  }

  static String _resolveUrl(String href, String baseUrl) {
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }

    final base = Uri.parse(baseUrl);
    if (href.startsWith('/')) {
      return '${base.scheme}://${base.host}${base.hasPort ? ':${base.port}' : ''}$href';
    }
    return base.resolve(href).toString();
  }
}
