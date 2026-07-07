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
  late DeviceRole _role;

  static const Color _accent = Color(0xFF4F6EF7);
  static const Color _accentLight = Color(0xFFEEF1FF);
  static const Color _surfaceBg = Color(0xFFF8F9FE);

  @override
  void initState() {
    super.initState();
    _role = widget.initialRole ?? DeviceRole.child;
  }

  void _confirm() {
    Navigator.of(context).pop(SetupResult(
      url: ConfigService.defaultServerUrl,
      role: _role,
    ));
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
                  '\u7528\u4e8e\u7ba1\u7406\u548c\u76d1\u7767',
                ),
              ),
            ],
          ),
          const SizedBox(height: 28),
          _buildConnectButton(),
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

  Widget _buildConnectButton() {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: _confirm,
        style: ElevatedButton.styleFrom(
          backgroundColor: _accent,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          elevation: 0,
          shadowColor: _accent.withAlpha(60),
        ),
        child: const Text(
          '\u5f00\u59cb\u4f7f\u7528',
          style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5),
        ),
      ),
    );
  }
}
