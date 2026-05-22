import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// IP 配置引导页
class IpConfigPage extends StatefulWidget {
  final VoidCallback onConfigured;
  const IpConfigPage({super.key, required this.onConfigured});

  @override
  State<IpConfigPage> createState() => _IpConfigPageState();
}

class _IpConfigPageState extends State<IpConfigPage> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final host = _controller.text.trim();
    if (host.isEmpty) {
      setState(() => _error = '请输入 PC 的 IP 地址');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final api = ApiService();
    await api.setBaseUrl(host);
    final data = await api.getData();

    if (data != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('server_host', host);
      widget.onConfigured();
    } else {
      setState(() {
        _loading = false;
        _error = '无法连接到服务器，请检查 IP 地址是否正确\n确保 PC 端已启动 server.py';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bg,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'PapaCheck',
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.accent,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                '爸~检查！',
                style: TextStyle(fontSize: 20, color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 40),
              const Text(
                '请输入 PC 的局域网 IP 地址',
                style: TextStyle(fontSize: 16, color: AppTheme.text),
              ),
              const SizedBox(height: 4),
              const Text(
                '（例如：192.168.1.100）',
                style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _controller,
                keyboardType: TextInputType.number,
                style: const TextStyle(fontSize: 18, color: AppTheme.text),
                decoration: InputDecoration(
                  hintText: '192.168.x.x',
                  hintStyle: const TextStyle(color: AppTheme.textSecondary),
                  filled: true,
                  fillColor: AppTheme.card,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: AppTheme.accent,
                      width: 2,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      color: AppTheme.danger,
                      fontSize: 14,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ElevatedButton(
                onPressed: _loading ? null : _connect,
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.bg,
                        ),
                      )
                    : const Text('连接'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
