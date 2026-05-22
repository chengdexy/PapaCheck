import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'theme/app_theme.dart';
import 'providers/app_provider.dart';
import 'pages/main_page.dart';
import 'pages/shop_page.dart';
import 'pages/settlement_page.dart';
import 'pages/rated_page.dart';
import 'pages/ip_config_page.dart';
import 'services/api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();
  final savedHost = prefs.getString('server_host');
  if (savedHost != null) {
    ApiService().setBaseUrl(savedHost);
  }

  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

  runApp(const ProviderScope(child: PapaCheckApp()));
}

class PapaCheckApp extends ConsumerWidget {
  const PapaCheckApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'PapaCheck',
      theme: AppTheme.darkTheme,
      debugShowCheckedModeBanner: false,
      builder: (context, child) {
        return MediaQuery.removePadding(
          context: context,
          removeTop: true,
          child: child!,
        );
      },
      home: const AppShell(),
    );
  }
}

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  bool _needIpConfig = true;

  @override
  void initState() {
    super.initState();
    _checkIpConfig();
  }

  Future<void> _checkIpConfig() async {
    final prefs = await SharedPreferences.getInstance();
    final host = prefs.getString('server_host');
    if (host != null && host.isNotEmpty) {
      final api = ApiService();
      final data = await api.getData();
      if (data != null) {
        setState(() => _needIpConfig = false);
        return;
      }
    }
    setState(() => _needIpConfig = true);
  }

  @override
  Widget build(BuildContext context) {
    if (_needIpConfig) {
      return IpConfigPage(
        onConfigured: () => setState(() => _needIpConfig = false),
      );
    }
    return const MainNavigator();
  }
}

class MainNavigator extends ConsumerStatefulWidget {
  const MainNavigator({super.key});

  @override
  ConsumerState<MainNavigator> createState() => _MainNavigatorState();
}

class _MainNavigatorState extends ConsumerState<MainNavigator> {
  @override
  void initState() {
    super.initState();
    final notifier = ref.read(appStateProvider.notifier);
    notifier.onPageChanged = () => setState(() {});
    notifier.init();
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final page = appState.currentPage;

    if (appState.isScreensaverActive) {
      return const _ScreensaverView();
    }

    switch (page) {
      case 'shop':
        return const ShopPage();
      case 'settlement':
        return const SettlementPage();
      case 'rated':
        return const RatedPage();
      default:
        return const MainPage();
    }
  }
}

class _ScreensaverView extends ConsumerWidget {
  const _ScreensaverView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(appStateProvider);
    final notifier = ref.read(appStateProvider.notifier);
    final now = notifier.currentDate;
    final dateStr =
        '${now.year}年${now.month}月${now.day}日  ${_weekday(now.weekday)}';

    return GestureDetector(
      onTap: () {
        ref.read(appStateProvider.notifier).wakeUp();
      },
      child: Scaffold(
        backgroundColor: AppTheme.bg,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  colors: [AppTheme.accent, Color(0xFF818CF8)],
                ).createShader(bounds),
                child: Text(
                  '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}',
                  style: const TextStyle(
                    fontSize: 200,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 40),
              Text(
                dateStr,
                style: const TextStyle(
                  fontSize: 48,
                  color: AppTheme.textSecondary,
                ),
              ),
              const SizedBox(height: 40),
              const Text(
                '点击屏幕唤醒',
                style: TextStyle(fontSize: 32, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _weekday(int day) {
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return days[day % 7];
  }
}
