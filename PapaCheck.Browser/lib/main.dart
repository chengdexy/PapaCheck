import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'services/config_service.dart';
import 'widgets/ip_config_dialog.dart';

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

class PapaCheckApp extends StatefulWidget {
  const PapaCheckApp({super.key});

  @override
  State<PapaCheckApp> createState() => _PapaCheckAppState();
}

class _PapaCheckAppState extends State<PapaCheckApp> {
  String? _url;
  WebViewController? _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _startup());
  }

  Future<void> _startup() async {
    final storedUrl = await ConfigService.getUrl();

    if (storedUrl == null || storedUrl.isEmpty) {
      if (!mounted) return;
      final url = await IpConfigDialog.show(context);
      if (url != null && mounted) {
        setState(() => _url = url);
        _initController(url);
      }
      return;
    }

    final ok = await _tryConnect(storedUrl);

    if (!mounted) return;

    if (ok) {
      setState(() => _url = storedUrl);
      _initController(storedUrl);
    } else {
      final reconfigure = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('连接失败'),
          content: Text('无法连接到 $storedUrl\n是否重新配置服务器地址？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('退出'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('重新配置'),
            ),
          ],
        ),
      );

      if (!mounted) return;

      if (reconfigure == true) {
        final url = await IpConfigDialog.show(context, initialUrl: storedUrl);
        if (url != null && mounted) {
          setState(() => _url = url);
          _initController(url);
        }
      }
    }
  }

  void _initController(String url) {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..loadRequest(Uri.parse(url));
  }

  Future<bool> _tryConnect(String url) async {
    try {
      final client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 5);
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close().timeout(
            const Duration(seconds: 5),
          );
      return response.statusCode < 500;
    } catch (_) {
      return false;
    }
  }

  Future<void> _openConfig() async {
    final url = await IpConfigDialog.show(context, initialUrl: _url);
    if (url != null && mounted) {
      setState(() => _url = url);
      _initController(url);
    }
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
  static const double _circleRadius = 30;
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
