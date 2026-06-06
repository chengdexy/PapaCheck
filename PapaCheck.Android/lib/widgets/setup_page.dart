import 'dart:io';

import 'package:flutter/material.dart';
import '../services/config_service.dart';

class SetupResult {
  final String url;
  final DeviceRole role;
  const SetupResult({required this.url, required this.role});
}

class SetupPage extends StatefulWidget {
  final String? initialUrl;
  final DeviceRole? initialRole;

  const SetupPage({super.key, this.initialUrl, this.initialRole});

  static Future<SetupResult?> show(
    BuildContext context, {
    String? initialUrl,
    DeviceRole? initialRole,
  }) {
    return Navigator.of(context).push<SetupResult>(
      MaterialPageRoute(
        builder: (_) => SetupPage(
          initialUrl: initialUrl,
          initialRole: initialRole,
        ),
        fullscreenDialog: true,
      ),
    );
  }

  @override
  State<SetupPage> createState() => _SetupPageState();
}

class _SetupPageState extends State<SetupPage> {
  late final TextEditingController _ipController;
  late final TextEditingController _portController;
  late DeviceRole _role;
  bool _connecting = false;
  String? _statusMessage;
  bool? _statusSuccess;

  @override
  void initState() {
    super.initState();
    _role = widget.initialRole ?? DeviceRole.child;
    if (widget.initialUrl != null) {
      final uri = Uri.tryParse(widget.initialUrl!);
      _ipController = TextEditingController(text: uri?.host ?? '');
      _portController = TextEditingController(
        text: (uri?.port ?? 8081).toString(),
      );
    } else {
      _ipController = TextEditingController(text: '192.168.1.');
      _portController = TextEditingController(text: '8081');
    }
  }

  @override
  void dispose() {
    _ipController.dispose();
    _portController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final ip = _ipController.text.trim();
    final port = _portController.text.trim();
    if (ip.isEmpty || port.isEmpty) return;

    final url = 'http://$ip:$port';

    setState(() {
      _connecting = true;
      _statusMessage = null;
      _statusSuccess = null;
    });

    final ok = await _tryConnect(url);

    if (!mounted) return;

    if (ok) {
      setState(() {
        _connecting = false;
        _statusMessage = '\u2705 \u8fde\u63a5\u6210\u529f';
        _statusSuccess = true;
      });
      await Future.delayed(const Duration(milliseconds: 500));
      if (!mounted) return;
      await ConfigService.setUrl(url);
      await ConfigService.setRole(_role);
      if (!mounted) return;
      Navigator.of(context).pop(SetupResult(url: url, role: _role));
    } else {
      setState(() {
        _connecting = false;
        _statusMessage = '\u274c \u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5730\u5740\u548c\u670d\u52a1\u72b6\u6001';
        _statusSuccess = false;
      });
    }
  }

  Future<bool> _tryConnect(String url) async {
    try {
      final client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 5);
      final request = await client.getUrl(Uri.parse('$url/api/version'));
      final response = await request.close().timeout(
            const Duration(seconds: 5),
          );
      client.close();
      return response.statusCode < 500;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // App Logo
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Center(
                    child: Text(
                      '\uD83D\uDCCB',
                      style: TextStyle(fontSize: 40),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  '\u7238\uff5e\u68c0\u67e5\uff01',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: Colors.black87,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  '\u6bcf\u65e5\u4f5c\u4e1a\u7ba1\u7406 \u00b7 \u79ef\u5206\u6fc0\u52b1',
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.grey,
                  ),
                ),
                const SizedBox(height: 32),

                // 说明文字
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text(
                    '\u9996\u6b21\u4f7f\u7528\u8bf7\u8fde\u63a5\u670d\u52a1\u5668\n\u8f93\u5165\u7535\u8111\u7aef\u7684\u5c40\u57df\u7f51 IP \u5730\u5740\u548c\u7aef\u53e3',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14, color: Colors.black54, height: 1.5),
                  ),
                ),
                const SizedBox(height: 24),

                // 角色选择
                const Text(
                  '\u9009\u62e9\u8bbe\u5907\u89d2\u8272',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Colors.black87,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: _buildRoleCard('\uD83C\uDFAE', '\u5b69\u5b50\u7aef', DeviceRole.child)),
                    const SizedBox(width: 12),
                    Expanded(child: _buildRoleCard('\uD83E\uDDED', '\u5bb6\u957f\u7aef', DeviceRole.parent)),
                  ],
                ),
                const SizedBox(height: 24),

                // 服务器地址
                const Text(
                  '\u670d\u52a1\u5668\u5730\u5740',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Colors.black87,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: _ipController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          hintText: '192.168.1.xxx',
                          labelText: 'IP \u5730\u5740',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 12,
                          ),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Text(':', style: TextStyle(fontSize: 18, color: Colors.grey)),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 1,
                      child: TextField(
                        controller: _portController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          hintText: '8081',
                          labelText: '\u7aef\u53e3',
                          border: OutlineInputBorder(),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 12,
                          ),
                          isDense: true,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // 连接按钮
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _connecting ? null : _connect,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.blue,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 2,
                    ),
                    child: _connecting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            '\u8fde\u63a5\u5e76\u5f00\u59cb\u4f7f\u7528',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                          ),
                  ),
                ),

                // 状态反馈
                if (_statusMessage != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: _statusSuccess == true
                          ? Colors.green.shade50
                          : Colors.red.shade50,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _statusSuccess == true ? Icons.check_circle : Icons.error_outline,
                          color: _statusSuccess == true ? Colors.green : Colors.red,
                          size: 18,
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            _statusMessage!,
                            style: TextStyle(
                              fontSize: 13,
                              color: _statusSuccess == true ? Colors.green.shade700 : Colors.red.shade700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRoleCard(String emoji, String label, DeviceRole role) {
    final selected = _role == role;
    return GestureDetector(
      onTap: () => setState(() => _role = role),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: selected ? Colors.blue.shade50 : Colors.grey.shade50,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? Colors.blue : Colors.grey.shade200,
            width: selected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Text(emoji, style: const TextStyle(fontSize: 32)),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 14,
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                color: selected ? Colors.blue : Colors.grey.shade600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
