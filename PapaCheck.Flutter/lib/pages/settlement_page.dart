import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/app_provider.dart';
import '../theme/app_theme.dart';
import '../utils/constants.dart';

class SettlementPage extends ConsumerWidget {
  const SettlementPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(appStateProvider.notifier);
    final settlement = notifier.settlementData;

    final basePoints = (settlement?['basePoints'] as int?) ?? 0;
    final efficiencyBonus = (settlement?['efficiencyBonus'] as int?) ?? 0;
    final total = (settlement?['totalBeforeRating'] as int?) ?? 0;
    final hwList = notifier.homeworks;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 640),
          margin: const EdgeInsets.all(20),
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(20),
            boxShadow: const [
              BoxShadow(
                color: Color(0x66000000),
                blurRadius: 40,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '全部作业完成！',
                style: TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.text,
                ),
              ),
              const SizedBox(height: 20),
              _SettlementRow(label: '基础积分', value: '+$basePoints', isTotal: false),
              const SizedBox(height: 8),
              _SettlementRow(label: '效率奖励', value: '+$efficiencyBonus', isTotal: false),
              const SizedBox(height: 8),
              _SettlementRow(
                label: '待结算',
                value: '$total 分',
                isTotal: true,
              ),
              if (hwList.isNotEmpty) ...[
                const SizedBox(height: 16),
                SizedBox(
                  height: 140,
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppTheme.bg,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: ListView(
                      children: hwList.map((hw) {
                        final subject = subjects[hw.subject] ?? subjects['其他']!;
                        final actual = hw.actualDuration ?? 0;
                        final suggested = hw.suggestedDuration;
                        String tag = '';
                        if (suggested > 0 && actual <= suggested * 0.8) {
                          tag = ' 提前';
                        } else if (suggested > 0 && actual > suggested) {
                          tag = ' 超时';
                        } else if (suggested > 0) {
                          tag = ' 准时';
                        }
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Text(
                            '${subject.icon} ${hw.subject} - ${hw.content}  ${actual} / $suggested 分钟$tag',
                            style: const TextStyle(
                              fontSize: 17,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => notifier.submitForRating(),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    textStyle: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  child: const Text('提交等待评级'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SettlementRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isTotal;
  const _SettlementRow({
    required this.label,
    required this.value,
    required this.isTotal,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(14),
        border: isTotal
            ? Border.all(color: AppTheme.accent, width: 2)
            : null,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 20,
              color: AppTheme.textSecondary,
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w700,
              color: AppTheme.accent,
            ),
          ),
        ],
      ),
    );
  }
}
