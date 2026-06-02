import 'package:flutter_test/flutter_test.dart';
import 'package:papacheck_android/services/asset_bundle_loader.dart';

void main() {
  group('AssetBundleLoader.resolveAssetPath', () {
    test('relative path resolves correctly', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        'css/admin.css',
      );
      expect(result, 'assets/web/css/admin.css');
    });

    test('absolute path resolves correctly', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        '/css/admin.css',
      );
      expect(result, 'assets/web/css/admin.css');
    });

    test('http URL returns null', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        'https://cdn.jsdelivr.net/npm/localforage/dist/localforage.min.js',
      );
      expect(result, isNull);
    });

    test('https URL returns null', () {
      final result = AssetBundleLoader.resolveAssetPath(
        'assets/web/admin.html',
        'http://example.com/script.js',
      );
      expect(result, isNull);
    });
  });

  group('AssetBundleLoader regex matching', () {
    test('stylesheet regex matches link tag', () {
      final match = AssetBundleLoader.stylesheetRegex
          .firstMatch('<link rel="stylesheet" href="css/admin.css">');
      expect(match, isNotNull);
      expect(match!.group(1), 'css/admin.css');
    });

    test('script regex matches script tag', () {
      final match = AssetBundleLoader.scriptSrcRegex
          .firstMatch('<script src="js/api.js"></script>');
      expect(match, isNotNull);
      expect(match!.group(1), 'js/api.js');
    });
  });
}
