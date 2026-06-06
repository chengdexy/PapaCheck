
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

  static const Color _accent = Color(0xFF4F6EF7);
  static const Color _accentLight = Color(0xFFEEF1FF);
  static const Color _surfaceBg = Color(0xFFF8F9FE);

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
      _statusMessage = '\u6b63\u5728\u8fde\u63a5...';
      _statusSuccess = null;
    });

    final ok = await _tryConnect(url);
    if (!mounted) return;

    if (ok) {
      setState(() {
        _connecting = false;
        _statusMessage = '\u8fde\u63a5\u6210\u529f';
        _statusSuccess = true;
      });
      await Future.delayed(const Duration(milliseconds: 500));
      if (!mounted) return;
      await ConfigService.setUrl(url);
      await ConfigService.setRole(_role);
      if (!mounted) return;
      Navigator.of(context)
          .pop(SetupResult(url: url, role: _role));
    } else {
      setState(() {
        _connecting = false;
        _statusMessage =
            '\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5730\u5740\u548c\u670d\u52a1\u72b6\u6001';
        _statusSuccess = false;
      });
    }
  }

  Future<bool> _tryConnect(String url) async {
    try {
      final client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 5);
      final request = await client.getUrl(
          Uri.parse('$url/api/version'));
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
      backgroundColor: _surfaceBg,
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              _buildHeader(),
              _buildBody(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(32, 48, 32, 40),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF4F6EF7), Color(0xFF6C5CE7)],
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(32),
          bottomRight: Radius.circular(32),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: Colors.white.withAlpha(230),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withAlpha(30),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: const Center(
              child: Text(
                '\u2714\uFE0F',
                style: TextStyle(fontSize: 36),
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            '\u7238\uff5e\u68c0\u67e5\uff01',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: Colors.white,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '\u6bcf\u65e5\u4f5c\u4e1a\u7ba1\u7406 \u00b7 \u79ef\u5206\u6fc0\u52b1',
            style: TextStyle(
              fontSize: 13,
              color: Colors.white.withAlpha(200),
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionTitle('\u8bbe\u5907\u89d2\u8272'),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _buildRoleCard(
                  '\uD83C\uDFAE',
                  '\u5b69\u5b50\u7aef',
                  DeviceRole.child,
                  '\u7528\u4e8e\u5b69\u5b50\u7684\u4f5c\u4e1a\u4e0e\u79ef\u5206',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildRoleCard(
                  '\uD83E\uDDED',
                  '\u5bb6\u957f\u7aef',
                  DeviceRole.parent,
                  '\u7528\u4e8e\u7ba1\u7406\u548c\u76d1\u7763',
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),
          _buildSectionTitle('\u670d\u52a1\u5668\u5730\u5740'),
          const SizedBox(height: 4),
          const Text(
            '\u8bf7\u8f93\u5165\u7535\u8111\u7aef\u5c40\u57df\u7f51 IP',
            style: TextStyle(fontSize: 13, color: Color(0xFF999999)),
          ),
          const SizedBox(height: 12),
          _buildInputRow(),
          const SizedBox(height: 28),
          _buildConnectButton(),
          if (_statusMessage != null) ...[
            const SizedBox(height: 16),
            _buildStatusBanner(),
          ],
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w700,
        color: Color(0xFF333333),
        letterSpacing: 0.3,
      ),
    );
  }

  Widget _buildRoleCard(
    String emoji,
    String label,
    DeviceRole role,
    String subtitle,
  ) {
    final selected = _role == role;
    return GestureDetector(
      onTap: () => setState(() => _role = role),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(
            vertical: 18, horizontal: 8),
        decoration: BoxDecoration(
          color: selected ? _accentLight : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? _accent : Colors.grey.shade200,
            width: selected ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: selected
                  ? _accent.withAlpha(20)
                  : Colors.black.withAlpha(8),
              blurRadius: selected ? 12 : 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: selected
                    ? _accent.withAlpha(25)
                    : Colors.grey.shade100,
                shape: BoxShape.circle,
              ),
              child: Center(
                child:
                    Text(emoji, style: const TextStyle(fontSize: 24)),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: selected
                    ? _accent
                    : const Color(0xFF666666),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: TextStyle(
                fontSize: 10,
                color: selected
                    ? _accent.withAlpha(180)
                    : const Color(0xFFAAAAAA),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputRow() {
    return Row(
      children: [
        Expanded(
          flex: 3,
          child: TextField(
            controller: _ipController,
            keyboardType: TextInputType.number,
            style: const TextStyle(
                fontSize: 15, fontWeight: FontWeight.w500),
            decoration: _inputDecoration(
                '192.168.1.xxx'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(
            '\uff1a',
            style: TextStyle(
                fontSize: 20, color: Colors.grey.shade400),
          ),
        ),
        Expanded(
          flex: 1,
          child: TextField(
            controller: _portController,
            keyboardType: TextInputType.number,
            style: const TextStyle(
                fontSize: 15, fontWeight: FontWeight.w500),
            decoration: _inputDecoration('8081'),
          ),
        ),
      ],
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: Colors.grey.shade300),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 14,
        vertical: 14,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.grey.shade200),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.grey.shade200),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide:
            const BorderSide(color: _accent, width: 1.5),
      ),
    );
  }

  Widget _buildConnectButton() {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: _connecting ? null : _connect,
        style: ElevatedButton.styleFrom(
          backgroundColor: _accent,
          foregroundColor: Colors.white,
          disabledBackgroundColor: _accent.withAlpha(100),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          elevation: 0,
          shadowColor: _accent.withAlpha(60),
        ),
        child: _connecting
            ? const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  ),
                  SizedBox(width: 10),
                  Text(
                    '\u6b63\u5728\u8fde\u63a5...',
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600),
                  ),
                ],
              )
            : const Text(
                '\u8fde\u63a5\u5e76\u5f00\u59cb\u4f7f\u7528',
                style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.5),
              ),
      ),
    );
  }

  Widget _buildStatusBanner() {
    final isSuccess = _statusSuccess == true;
    final isError = _statusSuccess == false;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
          horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: isSuccess
            ? const Color(0xFFF0FFF4)
            : isError
                ? const Color(0xFFFFF5F5)
                : const Color(0xFFF0F5FF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isSuccess
              ? const Color(0xFFB7EB8F)
              : isError
                  ? const Color(0xFFFFCCC7)
                  : const Color(0xFFD6E4FF),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isSuccess
                  ? const Color(0xFF52C41A)
                  : isError
                      ? const Color(0xFFFF4D4F)
                      : _accent,
            ),
            child: Center(
              child: isSuccess
                  ? const Icon(Icons.check,
                      color: Colors.white, size: 14)
                  : isError
                      ? const Icon(Icons.close,
                          color: Colors.white, size: 14)
                      : const SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _statusMessage ?? '',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: isSuccess
                    ? const Color(0xFF389E0D)
                    : isError
                        ? const Color(0xFFCF1322)
                        : _accent,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
