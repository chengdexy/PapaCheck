import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:battery_plus/battery_plus.dart';

import 'services/config_service.dart';
import 'services/offline_snapshot_service.dart';
import 'widgets/connect_failed_dialog.dart';
import 'widgets/setup_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      systemNavigationBarColor: Colors.transparent,
    ),
  );
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  runApp(const PapaCheckBrowser());
}

class PapaCheckBrowser extends StatelessWidget {
  const PapaCheckBrowser({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      builder: (context, child) {
        return MediaQuery.removePadding(
          context: context,
          removeTop: true,
          removeBottom: true,
          child: child!,
        );
      },
      home: const PapaCheckApp(),
    );
  }
}

/// 电池监控服务：周期性检测电量，低于阈值时通过 WebView 触发前端 TTS 语音提醒
class BatteryMonitor {
  static const _pollInterval = Duration(seconds: 30);
  static const _startupDelay = Duration(seconds: 3);

  final Battery _battery = Battery();
  Timer? _pollTimer;
  StreamSubscription<BatteryState>? _stateSubscription;
  WebViewController? _controller;
  bool _alerted20 = false;
  bool _alerted10 = false;
  BatteryState? _lastState;

  /// 纯逻辑：根据当前电量和已触发标记，返回应该触发的提醒类型（供测试使用）
  /// 返回 null 表示无需提醒，'20' 表示 20% 提醒，'10' 表示 10% 提醒
  static String? evaluateAlert(
      int batteryLevel, bool alerted20, bool alerted10) {
    if (batteryLevel <= 10 && !alerted10) return '10';
    if (batteryLevel <= 20 && !alerted20) return '20';
    return null;
  }

  void start(WebViewController controller) {
    _controller = controller;
    _alerted20 = false;
    _alerted10 = false;

    _stateSubscription =
        _battery.onBatteryStateChanged.listen(_onBatteryStateChanged);

    // 延迟启动检查，避免与页面初始化竞态
    Future.delayed(_startupDelay, _checkAndAlert);
    _pollTimer = Timer.periodic(_pollInterval, (_) => _checkAndAlert());
  }

  void stop() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _stateSubscription?.cancel();
    _stateSubscription = null;
    _controller = null;
  }

  Future<void> _checkAndAlert() async {
    if (_controller == null) return;
    try {
      final level = await _battery.batteryLevel;
      final alert = evaluateAlert(level, _alerted20, _alerted10);
      if (alert == '10') {
        _alerted10 = true;
        _alerted20 = true;
        _controller!.runJavaScript(
          "Voice.speak('\u7535\u91cf\u4e25\u91cd\u4e0d\u8db3\uff0c\u4ec5\u5269' + $level + '%\uff0c\u8bf7\u7acb\u5373\u5145\u7535')",
        );
      } else if (alert == '20') {
        _alerted20 = true;
        _controller!.runJavaScript(
          "Voice.speak('\u7535\u91cf\u4e0d\u8db3\uff0c\u8fd8\u5269' + $level + '%\uff0c\u8bf7\u5145\u7535')",
        );
      }
    } catch (_) {}
  }

  void _onBatteryStateChanged(BatteryState state) {
    if (_lastState != null && state == BatteryState.charging) {
      // 检测到充电，重置阈值标记
      _alerted20 = false;
      _alerted10 = false;
    }
    _lastState = state;
  }
}

class PapaCheckApp extends StatefulWidget {
  const PapaCheckApp({super.key});

  @override
  State<PapaCheckApp> createState() => _PapaCheckAppState();
}

class _PapaCheckAppState extends State<PapaCheckApp> {
  String? _url;
  DeviceRole? _role;
  WebViewController? _controller;
  bool _isPageReady = false;
  Timer? _readyCheckTimer;
  BatteryMonitor? _batteryMonitor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _startup());
  }

  @override
  void dispose() {
    _readyCheckTimer?.cancel();
    _batteryMonitor?.stop();
    super.dispose();
  }

  Future<void> _startup() async {
    final storedUrl = await ConfigService.getUrl();
    final storedRole = await ConfigService.getRole();

    if (storedUrl == null || storedUrl.isEmpty || storedRole == null) {
      // 首次安装：显示全屏引导页
      if (!mounted) return;
      final result = await SetupPage.show(context);
      if (result != null && mounted) {
        _applyOrientation(result.role);
        final fullUrl = _buildFullUrl(result.url, result.role);
        setState(() {
          _url = fullUrl;
          _role = result.role;
        });
        _initController(fullUrl);
        _trySaveOfflineSnapshot(fullUrl);
      }
      return;
    }

    // 已有配置：先尝试连接服务器
    _role = storedRole;
    _applyOrientation(storedRole);
    final fullUrl = _buildFullUrl(storedUrl, storedRole);

    final reachable = await _isServerReachable(fullUrl);
    if (reachable && mounted) {
      setState(() => _url = fullUrl);
      _initController(fullUrl);
      _trySaveOfflineSnapshot(fullUrl);
      if (mounted) _checkVersion(storedUrl);
      return;
    }

    // 服务器不可达，尝试从离线缓存加载
    if (mounted) {
      String? html = await OfflineSnapshotService.load(fullUrl);
      if (html != null && mounted) {
        setState(() {
          _url = fullUrl;
          _isPageReady = true;
        });
        await _initControllerOffline(fullUrl, html);
        _startBatteryMonitor();
        return;
      }
    }

    // 无缓存，回到配置页面
    if (!mounted) return;
    final action = await ConnectFailedDialog.show(context, url: storedUrl);
    if (!mounted) return;
    if (action == 'retry') {
      _startup();
    } else if (action == 'config') {
      final result = await SetupPage.show(
        context,
        initialUrl: storedUrl,
        initialRole: storedRole,
      );
      if (result != null && mounted) {
        await ConfigService.setUrl(result.url);
        await ConfigService.setRole(result.role);
        _applyOrientation(result.role);
        final fullUrl = _buildFullUrl(result.url, result.role);
        setState(() {
          _url = fullUrl;
          _role = result.role;
        });
        _initController(fullUrl);
        _trySaveOfflineSnapshot(fullUrl);
      }
    }
  }

  Future<void> _trySaveOfflineSnapshot(String fullUrl) async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.getUrl(Uri.parse(fullUrl));
      final response = await request.close().timeout(
            const Duration(seconds: 5),
          );
      if (response.statusCode >= 500) return;

      final html = await response.transform(utf8.decoder).join();
      await OfflineSnapshotService.save(fullUrl, html);
    } catch (_) {
      // 非致命：快照保存失败不影响主流程
    } finally {
      client.close();
    }
  }

  Future<void> _initController(String url) async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (error) {
            _handlePageLoadError(url);
          },
        ),
      );

    if (_controller!.platform is AndroidWebViewController) {
      (_controller!.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
    }

    _controller!.loadRequest(Uri.parse(url));
    _waitForPageReady();
  }

  Future<void> _initControllerOffline(String baseUrl, String html) async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white);

    if (_controller!.platform is AndroidWebViewController) {
      (_controller!.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
    }

    await _controller!.loadHtmlString(html, baseUrl: baseUrl);
  }

  void _waitForPageReady() {
    _readyCheckTimer?.cancel();
    var ticks = 0;
    _readyCheckTimer = Timer.periodic(
      const Duration(milliseconds: 500),
      (_) async {
        ticks++;
        if (_controller == null || !mounted) return;
        try {
          final result = await _controller!.runJavaScriptReturningResult(
            "document.getElementById('connStatus') ? document.getElementById('connStatus').className : 'missing'",
          );
          final className = result.toString();
          final isReady =
              className.contains('online') || className.contains('offline');
          final isTimedOut = ticks >= 30;
          if (isReady || isTimedOut) {
            _readyCheckTimer?.cancel();
            if (mounted) {
              setState(() => _isPageReady = true);
              _startBatteryMonitor();
            }
          }
        } catch (_) {
          if (ticks >= 30 && mounted) {
            _readyCheckTimer?.cancel();
            setState(() => _isPageReady = true);
            _startBatteryMonitor();
          }
        }
      },
    );
  }

  void _handlePageLoadError(String url) async {
    if (!mounted) return;

    // 先尝试离线缓存
    String? html = await OfflineSnapshotService.load(url);
    if (html != null && mounted) {
      await _initControllerOffline(url, html);
    } else if (mounted) {
      await _showConnectFailedDialog(url);
    }
  }

  Future<void> _showConnectFailedDialog(String url) async {
    if (!mounted) return;
    final baseUrl = _getBaseUrl(url);
    final action = await ConnectFailedDialog.show(context, url: baseUrl);
    if (!mounted) return;
    if (action == 'retry') {
      _startup();
    } else if (action == 'config') {
      _openConfig();
    }
  }

  Future<String> _fetchResource(String url) async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close().timeout(
            const Duration(seconds: 5),
          );
      return response.transform(utf8.decoder).join();
    } finally {
      client.close();
    }
  }

  Future<bool> _isServerReachable(String url) async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 3);
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close().timeout(
            const Duration(seconds: 3),
          );
      return response.statusCode < 500;
    } catch (_) {
      return false;
    } finally {
      client.close();
    }
  }

  Future<void> _openConfig() async {
    final baseUrl = _getBaseUrl(_url!);
    final result = await SetupPage.show(
      context,
      initialUrl: baseUrl,
      initialRole: _role,
    );
    if (result != null && mounted) {
      await ConfigService.setUrl(result.url);
      await ConfigService.setRole(result.role);
      _applyOrientation(result.role);
      final fullUrl = _buildFullUrl(result.url, result.role);
      setState(() {
        _url = fullUrl;
        _role = result.role;
      });
      _initController(fullUrl);
    }
  }

  Future<Map<String, dynamic>?> _fetchServerVersion(String baseUrl) async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.getUrl(Uri.parse('$baseUrl/api/version'));
      final response =
          await request.close().timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final body = await response.transform(utf8.decoder).join();
        return jsonDecode(body) as Map<String, dynamic>;
      }
    } catch (_) {
    } finally {
      client.close();
    }
    return null;
  }

  Future<void> _checkVersion(String baseUrl) async {
    final result = await _fetchServerVersion(baseUrl);
    if (result == null) return;

    final serverVersion = result['clientVersion'] ?? '?';
    final packageInfo = await PackageInfo.fromPlatform();
    final appVersion = packageInfo.version;

    if (serverVersion == appVersion) return;
    if (!mounted) return;

    final action = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('发现新版本'),
        content: Text(
          '您正在使用旧版本Android端。\n'
          'APK版本：$appVersion\n'
          '最新版本：$serverVersion',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop('cancel'),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop('update'),
            child: const Text('更新'),
          ),
        ],
      ),
    );

    if (action != 'update' || !mounted) return;
    await _downloadAndInstall('$baseUrl/api/download');
  }

  Future<void> _downloadAndInstall(String url) async {
    if (!mounted) return;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const AlertDialog(
        title: Text('正在下载更新...'),
        content: LinearProgressIndicator(),
      ),
    );

    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      final file = File('${Directory.systemTemp.path}/PapaCheck.apk');
      await response.pipe(file.openWrite());
      if (!mounted) return;
      Navigator.of(context).pop();
      await OpenFilex.open(file.path);
    } catch (e) {
      if (mounted) Navigator.of(context).pop();
    } finally {
      client.close();
    }
  }

  String _buildFullUrl(String baseUrl, DeviceRole role) {
    if (role == DeviceRole.parent) {
      return '$baseUrl/admin.html';
    }
    return baseUrl;
  }

  void _applyOrientation(DeviceRole role) {
    if (role == DeviceRole.child) {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
    } else {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
    }
  }

  String _getBaseUrl(String fullUrl) {
    return fullUrl.replaceAll('/admin.html', '');
  }

  void _startBatteryMonitor() {
    if (_controller == null) return;
    _batteryMonitor?.stop();
    _batteryMonitor = BatteryMonitor();
    _batteryMonitor!.start(_controller!);
  }

  @override
  Widget build(BuildContext context) {
    if (_url == null || _controller == null) {
      return const Scaffold(
        backgroundColor: Colors.white,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Stack(
      children: [
        BrowserPage(
          controller: _controller!,
          onConfigRequested: _openConfig,
        ),
        if (!_isPageReady)
          Container(
            color: Colors.black54,
            child: const Center(
              child: CircularProgressIndicator(color: Colors.white),
            ),
          ),
      ],
    );
  }
}

class BrowserPage extends StatefulWidget {
  final WebViewController controller;
  final VoidCallback onConfigRequested;

  const BrowserPage({
    super.key,
    required this.controller,
    required this.onConfigRequested,
  });

  @override
  State<BrowserPage> createState() => _BrowserPageState();
}

class _BrowserPageState extends State<BrowserPage> {
  int? _pointerId;
  Offset? _pointerStart;
  Timer? _longPressTimer;
  bool _indicatorVisible = false;
  Offset _indicatorPos = Offset.zero;

  static const double _zoneRatio = 0.35;
  static const double _circleRadius = 50;
  static const double _moveThreshold = 15;
  static const int _longPressSeconds = 3;

  bool _inTopRight(Offset pos, Size size) {
    return pos.dx > size.width * (1 - _zoneRatio) &&
        pos.dy < size.height * _zoneRatio;
  }

  bool _inBottomRight(Offset pos, Size size) {
    return pos.dx > size.width * (1 - _zoneRatio) &&
        pos.dy > size.height * (1 - _zoneRatio);
  }

  void _onPointerDown(PointerDownEvent e) {
    if (_pointerId != null) return;
    final size = context.size;
    if (size == null) return;
    if (!_inTopRight(e.localPosition, size)) return;

    _pointerId = e.pointer;
    _pointerStart = e.localPosition;
    _indicatorVisible = false;

    _longPressTimer?.cancel();
    _longPressTimer = Timer(const Duration(seconds: _longPressSeconds), () {
      if (!mounted) return;
      setState(() {
        _indicatorVisible = true;
        _indicatorPos = e.localPosition;
      });
    });
  }

  void _onPointerMove(PointerMoveEvent e) {
    if (e.pointer != _pointerId) return;

    if (!_indicatorVisible) {
      if (_pointerStart != null) {
        final dist = (e.localPosition - _pointerStart!).distance;
        if (dist > _moveThreshold) {
          _resetGesture();
        }
      }
      return;
    }

    setState(() {
      _indicatorPos = e.localPosition;
    });
  }

  void _onPointerUp(PointerUpEvent e) {
    if (e.pointer != _pointerId) return;

    if (_indicatorVisible) {
      final size = context.size;
      if (size != null && _inBottomRight(e.localPosition, size)) {
        _resetGesture();
        widget.onConfigRequested();
        return;
      }
    }
    _resetGesture();
  }

  void _onPointerCancel(PointerCancelEvent e) {
    if (e.pointer == _pointerId) {
      _resetGesture();
    }
  }

  void _resetGesture() {
    _pointerId = null;
    _pointerStart = null;
    _longPressTimer?.cancel();
    _longPressTimer = null;
    if (_indicatorVisible) {
      setState(() => _indicatorVisible = false);
    }
  }

  @override
  void dispose() {
    _resetGesture();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: _onPointerDown,
        onPointerMove: _onPointerMove,
        onPointerUp: _onPointerUp,
        onPointerCancel: _onPointerCancel,
        child: Stack(
          children: [
            WebViewWidget(controller: widget.controller),
            if (_indicatorVisible)
              Positioned(
                left: _indicatorPos.dx - _circleRadius,
                top: _indicatorPos.dy - _circleRadius,
                child: IgnorePointer(
                  child: Container(
                    width: _circleRadius * 2,
                    height: _circleRadius * 2,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white.withAlpha(120),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
