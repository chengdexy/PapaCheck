import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// 底部统计栏
class StatsBar extends StatelessWidget {
  final int doneCount;
  final int totalCount;
  final int points;
  final VoidCallback onShopTap;
  final VoidCallback onRewardsTap;

  const StatsBar({
    super.key,
    required this.doneCount,
    required this.totalCount,
    required this.points,
    required this.onShopTap,
    required this.onRewardsTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 20),
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
        children: [
          _StatItem(value: '$doneCount/$totalCount', label: '作业完成'),
          _StatItem(value: '$points', label: '积分'),
          const Spacer(),
          _NavButton(label: '积分商店', onTap: onShopTap),
          const SizedBox(width: 10),
          _NavButton(label: '我的奖励', onTap: onRewardsTap),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String value;
  final String label;
  const _StatItem({required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 38,
              fontWeight: FontWeight.w800,
              color: AppTheme.accent,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _NavButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.accent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: AppTheme.bg,
          ),
        ),
      ),
    );
  }
}
