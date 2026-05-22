import 'dart:io';

import 'package:flutter/material.dart';
import '../services/config_service.dart';

class IpConfigDialog extends StatefulWidget {
  final String? initialUrl;

  const IpConfigDialog({super.key, this.initialUrl});

  static Future<String?> show(BuildContext context, {String? initialUrl}) {
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => IpConfigDialog(initialUrl: initialUrl),
    );
  }

  @override
  State<IpConfigDialog> createState() => _IpConfigDialogState();
}

class _IpConfigDialogState extends State<IpConfigDialog> {
  late final TextEditingController _ipController;
  late final TextEditingController _portController;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialUrl != null) {
      final uri = Uri.tryParse(widget.initialUrl!);
      _ipController = TextEditingController(
        text: uri?.host ?? '',
      );
      _portController = TextEditingController(
        text: (uri?.port ?? 8080).toString(),
      );
    } else {
      _ipController = TextEditingController(text: '192.168.1.196');
      _portController = TextEditingController(text: '8080');
    }
  }

  @override
  void dispose() {
    _ipController.dispose();
    _portController.dispose();
    super.dispose();
  }

  Future<void> _testAndSave() async {
    final ip = _ipController.text.trim();
    final port = _portController.text.trim();
    if (ip.isEmpty || port.isEmpty) return;

    final url = 'http://$ip:$port';

    setState(() => _testing = true);

    final ok = await _tryConnect(url);

    setState(() => _testing = false);

    if (!mounted) return;

    if (ok) {
      await ConfigService.setUrl(url);
      if (!mounted) return;
      Navigator.of(context).pop(url);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('连接失败，请检查 IP 和端口，并确保电脑端服务已启动'),
          duration: Duration(seconds: 3),
        ),
      );
    }
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('配置服务器地址'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            '请输入电脑的局域网 IP 和端口',
            style: TextStyle(fontSize: 13, color: Colors.grey),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Text('IP：', style: TextStyle(fontSize: 16)),
              Expanded(
                child: TextField(
                  controller: _ipController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    hintText: '192.168.x.x',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 10,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text('端口：', style: TextStyle(fontSize: 16)),
              Expanded(
                child: TextField(
                  controller: _portController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    hintText: '8080',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 10,
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (_testing)
            const Padding(
              padding: EdgeInsets.only(top: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 8),
                  Text('正在测试连接...'),
                ],
              ),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _testing ? null : () => Navigator.of(context).pop(null),
          child: const Text('取消'),
        ),
        ElevatedButton(
          onPressed: _testing ? null : _testAndSave,
          child: const Text('测试并保存'),
        ),
      ],
    );
  }
}
