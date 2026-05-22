import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Buff 状态栏
class BuffBar extends StatelessWidget {
  final List<dynamic> buffs;
  const BuffBar({super.key, required this.buffs});

  @override
  Widget build(BuildContext context) {
    if (buffs.isEmpty) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
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
      child: Wrap(
        spacing: 8,
        children: buffs.map((b) {
          final name = (b is Map) ? (b['name'] ?? '') : '';
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('✨', style: TextStyle(fontSize: 16)),
              const SizedBox(width: 4),
              Text(
                name,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.accent,
                ),
              ),
            ],
          );
        }).toList(),
      ),
    );
  }
}
