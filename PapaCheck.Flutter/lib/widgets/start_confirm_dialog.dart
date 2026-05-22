import 'package:flutter/material.dart';
import '../models/homework.dart';
import '../utils/constants.dart';
import '../theme/app_theme.dart';

class StartConfirmDialog extends StatelessWidget {
  final Homework homework;
  final bool isTomorrowHoliday;
  final VoidCallback onStart;
  final VoidCallback onDefer;

  const StartConfirmDialog({
    super.key,
    required this.homework,
    required this.isTomorrowHoliday,
    required this.onStart,
    required this.onDefer,
  });

  @override
  Widget build(BuildContext context) {
    final subject = subjects[homework.subject] ?? subjects['其他']!;

    return AlertDialog(
      backgroundColor: AppTheme.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      contentPadding: const EdgeInsets.all(24),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${subject.icon} ${homework.subject}',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 32, color: AppTheme.text),
          ),
          const SizedBox(height: 4),
          Text(
            homework.content,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 20,
              color: AppTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          if (homework.rejected) ...[
            const Text(
              '⚠️ 已驳回，不计时重新完成',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 20, color: AppTheme.danger),
            ),
          ] else ...[
            Text(
              '建议 ${homework.suggestedDuration} 分钟内完成',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 20, color: AppTheme.accent),
            ),
          ],
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              OutlinedButton(
                onPressed: () => Navigator.pop(context),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.textSecondary,
                  side: const BorderSide(
                      color: AppTheme.textSecondary, width: 2),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 10),
                ),
                child: const Text(
                  '✕ 取消',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textSecondary),
                ),
              ),
              if (!homework.rejected && isTomorrowHoliday) ...[
                const SizedBox(width: 10),
                OutlinedButton(
                  onPressed: () {
                    onDefer();
                    Navigator.pop(context);
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.warning,
                    side: const BorderSide(
                        color: AppTheme.warning, width: 2),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 10),
                  ),
                  child: const Text(
                    '⏭️ 明天做',
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.warning),
                  ),
                ),
              ],
              const SizedBox(width: 10),
              ElevatedButton(
                onPressed: () {
                  onStart();
                  Navigator.pop(context);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.accent,
                  foregroundColor: AppTheme.bg,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 10),
                ),
                child: const Text(
                  '⚔️ 开始',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
