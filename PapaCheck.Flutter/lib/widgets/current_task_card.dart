import 'dart:math';
import 'package:flutter/material.dart';
import '../models/homework.dart';
import '../models/free_time_task.dart';
import '../utils/constants.dart';
import '../theme/app_theme.dart';

/// 当前任务卡片
class CurrentTaskCard extends StatelessWidget {
  final Homework? activeHw;
  final FreeTimeTask? activeFt;
  final dynamic active;
  final List<Homework> homeworks;
  final int pointsBalance;
  final Map<String, dynamic> pointsHistory;

  const CurrentTaskCard({
    super.key,
    required this.activeHw,
    required this.activeFt,
    required this.active,
    required this.homeworks,
    required this.pointsBalance,
    required this.pointsHistory,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '当前任务',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              color: AppTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          Expanded(child: _buildContent()),
        ],
      ),
    );
  }

  Widget _buildContent() {
    // 进行中的自由时间
    if (activeFt != null) {
      return _buildFreeTimeContent(activeFt!);
    }

    // 进行中的作业
    if (activeHw != null) {
      return _buildHomeworkContent(activeHw!);
    }

    // 无任务：显示状态
    final pendingCount = homeworks.where((h) => h.isPending).length;
    final doneCount = homeworks.where((h) => h.isDone).length;

    if (pendingCount > 0) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('📋', style: TextStyle(fontSize: 60)),
            const SizedBox(height: 12),
            Text(
              '$pendingCount 项作业待完成',
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                color: AppTheme.accent,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              '点击右侧作业卡片开始吧！',
              style: TextStyle(fontSize: 18, color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    if (homeworks.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('🌟', style: TextStyle(fontSize: 60)),
            SizedBox(height: 12),
            Text(
              '今天没有作业',
              style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.text),
            ),
            SizedBox(height: 10),
            Text(
              '去玩吧！',
              style: TextStyle(fontSize: 18, color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    if (doneCount == homeworks.length) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('🎉', style: TextStyle(fontSize: 60)),
            SizedBox(height: 12),
            Text(
              '全部完成',
              style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.success),
            ),
            SizedBox(height: 10),
            Text(
              '等待评级中...',
              style: TextStyle(fontSize: 18, color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    return const Center(
      child: Text('暂无进行中的任务',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 18)),
    );
  }

  Widget _buildHomeworkContent(Homework hw) {
    final subject = subjects[hw.subject] ?? subjects['其他']!;
    final startedAt = DateTime.tryParse(hw.startedAt ?? '') ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
    final totalSeconds = hw.suggestedDuration * 60;

    if (hw.isChallenge) {
      final remainingSeconds = max(0, totalSeconds - elapsedSeconds);
      final progress =
          totalSeconds > 0 ? min(1.0, elapsedSeconds / totalSeconds) : 1.0;

      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(subject.icon, style: const TextStyle(fontSize: 60)),
            const SizedBox(height: 10),
            Text(
              '${hw.subject} · ${hw.content}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 36,
                fontWeight: FontWeight.w700,
                color: AppTheme.text,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 10),
            Text(
              '挑战模式 · ${hw.suggestedDuration}分钟',
              style: const TextStyle(
                fontSize: 22,
                color: AppTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: 400,
              child: _ProgressBar(progress: progress),
            ),
            const SizedBox(height: 12),
            Text(
              '剩余 ${_formatTime(remainingSeconds)}',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                color: remainingSeconds < 120
                    ? AppTheme.warning
                    : remainingSeconds <= 0
                        ? AppTheme.danger
                        : AppTheme.accent,
              ),
            ),
          ],
        ),
      );
    } else {
      // 计时模式
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(subject.icon, style: const TextStyle(fontSize: 60)),
            const SizedBox(height: 10),
            Text(
              '${hw.subject} · ${hw.content}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 36,
                fontWeight: FontWeight.w700,
                color: AppTheme.text,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 10),
            const Text(
              '计时模式',
              style: TextStyle(
                fontSize: 22,
                color: AppTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              '已用 ${_formatTime(elapsedSeconds)}',
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w600,
                color: AppTheme.accent,
              ),
            ),
          ],
        ),
      );
    }
  }

  Widget _buildFreeTimeContent(FreeTimeTask ft) {
    final startedAt = DateTime.tryParse(ft.startedAt ?? '') ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
    final totalSeconds = ft.durationMinutes * 60;
    final remainingSeconds = max(0, totalSeconds - elapsedSeconds);
    final progress =
        totalSeconds > 0 ? min(1.0, elapsedSeconds / totalSeconds) : 1.0;

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const Text('🎮', style: TextStyle(fontSize: 60)),
          const SizedBox(height: 10),
          Text(
            ft.name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 36,
              fontWeight: FontWeight.w700,
              color: AppTheme.text,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            '${ft.durationMinutes}分钟',
            style: const TextStyle(
              fontSize: 22,
              color: AppTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: 400,
            child: _ProgressBar(progress: progress, isFreeTime: true),
          ),
          const SizedBox(height: 12),
          Text(
            remainingSeconds > 0
                ? '剩余 ${_formatTime(remainingSeconds)}'
                : '时间到！',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              color: remainingSeconds <= 0
                  ? AppTheme.danger
                  : remainingSeconds < 120
                      ? AppTheme.warning
                      : AppTheme.accent,
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
}

/// 进度条组件
class _ProgressBar extends StatelessWidget {
  final double progress;
  final bool isFreeTime;
  const _ProgressBar({required this.progress, this.isFreeTime = false});

  @override
  Widget build(BuildContext context) {
    final p = progress.clamp(0.0, 1.0);

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 16,
        color: const Color(0x1AFFFFFF),
        child: FractionallySizedBox(
          alignment: Alignment.centerLeft,
          widthFactor: p,
          child: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.accent, Color(0xFF818CF8)],
              ),
              borderRadius: BorderRadius.only(
                topRight: Radius.circular(8),
                bottomRight: Radius.circular(8),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
