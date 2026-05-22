import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/app_provider.dart';
import '../utils/date_utils.dart' as du;
import '../theme/app_theme.dart';

class ClockHeader extends ConsumerWidget {
  const ClockHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final notifier = ref.read(appStateProvider.notifier);
    final now = notifier.currentDate;
    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final dateStr = du.formatDate(now);
    final connected = appState.isServerMode;
    final loaded = appState.isLoaded;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x4D000000),
            blurRadius: 20,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                dateStr,
                style: const TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.text,
                ),
              ),
              const SizedBox(width: 12),
              _buildStatusDot(connected, loaded),
            ],
          ),
          ShaderMask(
            shaderCallback: (bounds) => const LinearGradient(
              colors: [AppTheme.accent, Color(0xFF818CF8)],
            ).createShader(bounds),
            child: Text(
              timeStr,
              style: const TextStyle(
                fontSize: 56,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusDot(bool connected, bool loaded) {
    if (!loaded) {
      return const SizedBox(
        width: 12,
        height: 12,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: AppTheme.warning,
        ),
      );
    }
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: connected ? AppTheme.success : AppTheme.warning,
        boxShadow: connected
            ? [
                BoxShadow(
                  color: AppTheme.success.withAlpha(100),
                  blurRadius: 6,
                  spreadRadius: 1,
                ),
              ]
            : null,
      ),
    );
  }
}
