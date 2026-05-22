import 'dart:math';
import 'package:flutter/material.dart';
import '../models/homework.dart';
import '../utils/constants.dart';
import '../theme/app_theme.dart';

class HomeworkCard extends StatelessWidget {
  final Homework homework;
  final VoidCallback? onTap;

  const HomeworkCard({super.key, required this.homework, this.onTap});

  @override
  Widget build(BuildContext context) {
    final subject = subjects[homework.subject] ?? subjects['其他']!;
    final isDone = homework.isDone;
    final isActive = homework.isActive;
    final isPending = homework.isPending;

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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(subject.icon, style: const TextStyle(fontSize: 28)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          homework.subject,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            color: AppTheme.text,
                          ),
                        ),
                        if (homework.isChallenge)
                          const Text(
                            ' 挑战',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        if (isPending && homework.rejected)
                          const Text(
                            ' 不计时',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                      ],
                    ),
                    if (homework.content.isNotEmpty)
                      Text(
                        homework.content,
                        style: const TextStyle(
                          fontSize: 15,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                  ],
                ),
              ),
              _buildRightSection(homework, isActive, isDone, isPending),
            ],
          ),
          _buildProgressSection(homework, isActive, isDone, isPending),
        ],
      ),
    );

    if (isDone) {
      return Opacity(opacity: 0.5, child: card);
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

  Widget _buildRightSection(
      Homework hw, bool isActive, bool isDone, bool isPending) {
    if (hw.isDeferPending) {
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '⏳ 等待确认...',
            style: TextStyle(
              fontSize: 13,
              color: AppTheme.warning,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    if (hw.rejected && isPending) {
      return const Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '被驳回',
            style: TextStyle(
              fontSize: 13,
              color: AppTheme.danger,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    if (isActive) {
      return _TimerDisplay(homework: hw);
    }

    if (isDone) {
      final actual = hw.actualDuration ?? 0;
      final suggested = hw.suggestedDuration;
      String efficiencyText = '';
      if (suggested > 0 && actual <= suggested * 0.8) {
        efficiencyText = '效率优秀';
      } else if (suggested > 0 && actual <= suggested) {
        efficiencyText = '效率良好';
      } else if (suggested > 0) {
        efficiencyText = '略微超时';
      }

      return Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '已完成 · ${actual}分钟',
            style: const TextStyle(
              fontSize: 13,
              color: AppTheme.success,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (efficiencyText.isNotEmpty)
            Text(
              efficiencyText,
              style: const TextStyle(
                fontSize: 11,
                color: AppTheme.textSecondary,
              ),
            ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        const Text(
          '未开始',
          style: TextStyle(
            fontSize: 13,
            color: AppTheme.warning,
            fontWeight: FontWeight.w600,
          ),
        ),
        Text(
          '${hw.suggestedDuration}分钟',
          style: const TextStyle(
            fontSize: 12,
            color: AppTheme.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildProgressSection(
      Homework hw, bool isActive, bool isDone, bool isPending) {
    if (hw.isDeferPending) {
      return const Padding(
        padding: EdgeInsets.only(top: 6),
        child: _MiniProgress(value: 0, color: AppTheme.warning),
      );
    }

    if (isActive && hw.isChallenge) {
      final startedAt =
          DateTime.tryParse(hw.startedAt ?? '') ?? DateTime.now();
      final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
      final totalSeconds = hw.suggestedDuration * 60;
      final progressValue =
          totalSeconds > 0 ? (elapsedSeconds / totalSeconds).clamp(0.0, 1.0) : 1.0;

      Color barColor = AppTheme.accent;
      if (progressValue >= 1.0) {
        barColor = AppTheme.danger;
      } else if (progressValue >= 0.8) {
        barColor = AppTheme.warning;
      }

      return Padding(
        padding: const EdgeInsets.only(top: 6),
        child: _MiniProgress(value: progressValue, color: barColor),
      );
    }

    if (isActive && !hw.isChallenge) {
      return Padding(
        padding: const EdgeInsets.only(top: 6),
        child: _MiniProgress(value: 0, color: AppTheme.accent),
      );
    }

    if (isDone) {
      return const Padding(
        padding: EdgeInsets.only(top: 6),
        child: _MiniProgress(value: 1.0, color: AppTheme.success),
      );
    }

    return const Padding(
      padding: EdgeInsets.only(top: 6),
      child: _MiniProgress(value: 0, color: AppTheme.warning),
    );
  }
}

class _MiniProgress extends StatelessWidget {
  final double value;
  final Color color;
  const _MiniProgress({required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(3),
      child: LinearProgressIndicator(
        value: value,
        minHeight: 5,
        backgroundColor: const Color(0x1AFFFFFF),
        valueColor: AlwaysStoppedAnimation<Color>(color),
      ),
    );
  }
}

class _TimerDisplay extends StatelessWidget {
  final Homework homework;
  const _TimerDisplay({required this.homework});

  @override
  Widget build(BuildContext context) {
    if (!homework.isChallenge) {
      return const Text(
        '进行中',
        style: TextStyle(
          fontSize: 13,
          color: AppTheme.accent,
          fontWeight: FontWeight.w600,
        ),
      );
    }

    final startedAt =
        DateTime.tryParse(homework.startedAt ?? '') ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
    final totalSeconds = homework.suggestedDuration * 60;
    final remainingSeconds = max(0, totalSeconds - elapsedSeconds);

    Color timerColor;
    if (remainingSeconds <= 0) {
      timerColor = AppTheme.danger;
    } else if (remainingSeconds < 120) {
      timerColor = AppTheme.warning;
    } else {
      timerColor = AppTheme.accent;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          remainingSeconds > 0 ? _formatTime(remainingSeconds) : '超时',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: timerColor,
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
