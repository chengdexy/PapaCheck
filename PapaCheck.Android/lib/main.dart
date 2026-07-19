import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:battery_plus/battery_plus.dart';

import 'services/config_service.dart';
import 'services/update_service.dart';
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
    if (_lastState == BatteryState.discharging &&
        state == BatteryState.charging) {
      // 检测到从 discharging 切换到 charging，重置阈值标记
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
  BatteryMonitor? _batteryMonitor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _startup());
  }

  @override
  void dispose() {
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
        // 首次安装：保存 URL 和角色，确保下次启动不再次显示引导页
        await ConfigService.setUrl(result.url);
        await ConfigService.setRole(result.role);

        // 首次安装记录版本号
        try {
          final packageInfo = await PackageInfo.fromPlatform();
          final currentVersion =
              '${packageInfo.version}+${packageInfo.buildNumber}';
          await ConfigService.setLastVersion(currentVersion);
        } catch (_) {}

        _applyOrientation(result.role);
        final fullUrl = _buildFullUrl(result.url, result.role);
        setState(() {
          _url = fullUrl;
          _role = result.role;
        });
        _initController(fullUrl);
      }
      return;
    }

    // 已有配置：先尝试连接服务器
    _role = storedRole;
    _applyOrientation(storedRole);
    final fullUrl = _buildFullUrl(storedUrl, storedRole);

    // 记录版本号（首次安装）
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      final currentVersion =
          '${packageInfo.version}+${packageInfo.buildNumber}';
      if (await ConfigService.getLastVersion() == null) {
        await ConfigService.setLastVersion(currentVersion);
      }
    } catch (_) {
      // 版本检测失败不阻塞启动
    }

    final reachable = await _isServerReachable(fullUrl);
    if (reachable && mounted) {
      setState(() => _url = fullUrl);
      _initController(fullUrl);
      if (mounted) _checkVersion();
      return;
    }

    // 服务器不可达，提示用户重试或重新配置
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
      }
    }
  }

  Future<void> _initController(String url) async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..addJavaScriptChannel(
        'PapaCheckBridge',
        onMessageReceived: (message) {
          _handleBridgeMessage(message.message);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (error) {
            _handlePageLoadError(url);
          },
        ),
      );

    // 清空 WebView 缓存，避免升级安装后保留旧版网页 JS 缓存导致家长端遮罩永久卡死
    await _controller!.clearCache();

    if (_controller!.platform is AndroidWebViewController) {
      final androidController = _controller!.platform as AndroidWebViewController;
      androidController.setMediaPlaybackRequiresUserGesture(false);
    }
    // 说明：webview_flutter_android 4.3.x 无 setCacheMode / AndroidWebViewCacheMode，
    // 已由上方 _controller.clearCache() 在启动时清空缓存，强制本次会话拉取最新网页，
    // 配合已部署网页端「5s 自动隐藏遮罩 + 15s fetch 超时」彻底解决卡死。

    // 检查是否有持久化的 auth token，有则先加载注入中间页
    final savedToken = await ConfigService.getAuthToken();
    if (savedToken != null && savedToken.isNotEmpty) {
      final savedRole = await ConfigService.getAuthRole() ?? '';
      final savedChildName = await ConfigService.getAuthChildName() ?? '';
      await _loadWithSessionRestore(
        url, savedToken, savedRole, savedChildName);
    } else {
      _controller!.loadRequest(Uri.parse(url));
    }

    _startBatteryMonitor();
  }

  /// 加载中间 HTML 页面，将持久化的认证信息写入 WebView 的 sessionStorage，
  /// 然后重定向到目标 URL。用于 Android WebView 冷启动时恢复登录状态。
  ///
  /// 使用服务端的 restore-session.html 而非 data: URI，因为 data: 页面
  /// 的 sessionStorage 与 http: 页面不共享（不同 origin）。
  Future<void> _loadWithSessionRestore(
    String targetUrl,
    String token,
    String role,
    String childName,
  ) async {
    // 从 targetUrl 提取 baseUrl
    final uri = Uri.parse(targetUrl);
    final baseUrl = '${uri.scheme}://${uri.host}${(uri.port == 80 || uri.port == 443) ? '' : ':${uri.port}'}';

    final queryParams = {
      'token': token,
      if (role.isNotEmpty) 'role': role,
      if (childName.isNotEmpty) 'childName': childName,
      'target': targetUrl,
    };
    final restoreUri = Uri.parse('$baseUrl/papacheck/app/restore-session.html').replace(queryParameters: queryParams);

    await _controller!.loadRequest(restoreUri);
  }

  void _handleBridgeMessage(String jsonMessage) {
    try {
      final data = jsonDecode(jsonMessage) as Map<String, dynamic>;
      final type = data['type'] as String?;
      if (type == 'auth_token') {
        final token = data['token'] as String?;
        final role = data['role'] as String?;
        final childName = data['childName'] as String?;
        final baseUrl = data['baseUrl'] as String?;
        if (token != null && baseUrl != null) {
          // 持久化 auth 数据到 SharedPreferences，
          // 用于 Android WebView 冷启动后恢复 sessionStorage
          ConfigService.setAuthData(
            token: token,
            role: role ?? '',
            childName: childName ?? '',
          );
        }
      }
    } catch (_) {
      // 非致命：桥接消息解析失败静默忽略
    }
  }

  void _handlePageLoadError(String url) async {
    if (!mounted) return;
    await _showConnectFailedDialog(url);
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

  Future<Map<String, dynamic>?> _fetchServerVersion() async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 5);
    try {
      final request = await client.getUrl(Uri.parse(versionUrl));
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

  Future<void> _checkVersion() async {
    final result = await _fetchServerVersion();
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
    await _downloadAndInstall(downloadUrl);
  }

  Future<void> _downloadAndInstall(String url) async {
    if (!mounted) return;
    double progress = 0;
    void Function(void Function())? dialogSetState;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: const Text('正在下载更新...'),
        content: StatefulBuilder(
          builder: (context, setState) {
            dialogSetState = setState;
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                LinearProgressIndicator(value: progress > 0 ? progress : null),
                const SizedBox(height: 8),
                Text('${(progress * 100).toInt()}%'),
              ],
            );
          },
        ),
      ),
    );

    try {
      await UpdateService.downloadAndInstall(
        url,
        onProgress: (p) {
          progress = p;
          dialogSetState?.call(() {});
        },
      );
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  String _buildFullUrl(String baseUrl, DeviceRole role) {
    // 防止 baseUrl 尾部已有斜杠时拼接出双斜杠
    final base = baseUrl.isNotEmpty && baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;

    if (role == DeviceRole.parent) {
      // 家长端打开 /login.html（访问码登录）
      return '$base/login.html';
    }
    // 孩子端打开首页 /index.html
    return '$base/index.html';
  }

  void _applyOrientation(DeviceRole role) {
    if (role == DeviceRole.child) {
      // 孩子端允许竖屏+横屏，手机竖屏走紧凑布局
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
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
    // 精确匹配末尾的 /child、/parent 或 /login 后缀，避免误替换域名中的匹配段
    return fullUrl.replaceFirst(RegExp(r'/(?:child|parent|login)$'), '');
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

    return BrowserPage(
      controller: _controller!,
      onConfigRequested: _openConfig,
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
