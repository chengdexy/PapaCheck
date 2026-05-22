import 'dart:math';
import 'package:flutter/material.dart';
import '../models/free_time_task.dart';
import '../theme/app_theme.dart';

/// 自由时间卡片
class FreeTimeCard extends StatelessWidget {
  final FreeTimeTask task;
  final VoidCallback? onTap;

  const FreeTimeCard({super.key, required this.task, this.onTap});

  @override
  Widget build(BuildContext context) {
    final isDone = task.isDone;
    final isActive = task.isActive;

    final card = Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isActive
              ? AppTheme.accent.withAlpha(200)
              : Colors.transparent,
          width: 3,
        ),
      ),
      child: Row(
        children: [
          const Text('🎮', style: TextStyle(fontSize: 28)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.name,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.text,
                  ),
                ),
                Text(
                  '${task.durationMinutes}分钟',
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (isActive) _buildActiveStatus(),
          if (isDone)
            const Text(
              '已完成',
              style: TextStyle(
                fontSize: 15,
                color: AppTheme.success,
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ),
    );

    if (isDone) {
      return Opacity(
        opacity: 0.5,
        child: card,
      );
    }

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: card,
      );
    }

    return card;
  }

  Widget _buildActiveStatus() {
    final startedAt = DateTime.tryParse(task.startedAt ?? '') ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
    final totalSeconds = task.durationMinutes * 60;
    final remainingSeconds = max(0, totalSeconds - elapsedSeconds);
    final progress = totalSeconds > 0
        ? min(1.0, elapsedSeconds / totalSeconds)
        : 1.0;

    Color color;
    if (remainingSeconds <= 0) {
      color = AppTheme.danger;
    } else if (remainingSeconds < 120) {
      color = AppTheme.warning;
    } else {
      color = AppTheme.accent;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          remainingSeconds > 0 ? _formatTime(remainingSeconds) : '超时',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
        const SizedBox(height: 6),
        SizedBox(
          width: 60,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 5,
              backgroundColor: const Color(0x1AFFFFFF),
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ),
      ],
    );
  }

  String _formatTime(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
}
