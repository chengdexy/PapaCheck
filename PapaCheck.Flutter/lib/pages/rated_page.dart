import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/app_provider.dart';
import '../theme/app_theme.dart';

class RatedPage extends ConsumerStatefulWidget {
  const RatedPage({super.key});

  @override
  ConsumerState<RatedPage> createState() => _RatedPageState();
}

class _RatedPageState extends ConsumerState<RatedPage> {
  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(seconds: 5), () {
      if (mounted) {
        ref.read(appStateProvider.notifier).setPage('main');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final notifier = ref.read(appStateProvider.notifier);
    final settlement = notifier.settlementData;
    if (settlement == null) return const SizedBox.shrink();

    final rating = settlement['rating'] ?? '--';
    final finalPoints = settlement['finalPoints'] ?? 0;
    final multiplier = settlement['multiplier'] ?? 1.0;
    final basePoints = settlement['basePoints'] ?? 0;
    final efficiencyBonus = settlement['efficiencyBonus'] ?? 0;

    const encourage = {
      '优': '太棒了！继续保持！',
      '良': '做得不错，下次争取更优秀！',
      '可': '继续加油，你可以做得更好！',
      '差': '别灰心，明天重新开始！',
    };
    final msg = encourage[rating] ?? '你真棒！';

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
                '爸爸已评级',
                style: TextStyle(
                  fontSize: 24,
                  color: AppTheme.textSecondary,
                ),
              ),
              const SizedBox(height: 4),
              ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  colors: [AppTheme.accent, AppTheme.success],
                ).createShader(bounds),
                child: Text(
                  rating,
                  style: const TextStyle(
                    fontSize: 64,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '倍率 x$multiplier',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.accent,
                ),
              ),
              const SizedBox(height: 14),
              _SettlementRow(
                  label: '基础积分 + 效率奖励',
                  value: '${basePoints + efficiencyBonus}'),
              const SizedBox(height: 4),
              _SettlementRow(label: '评级倍率', value: 'x$multiplier'),
              const SizedBox(height: 4),
              _SettlementRow(
                  label: '最终积分', value: '$finalPoints', isTotal: true),
              const SizedBox(height: 14),
              Text(
                msg,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.success,
                ),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => notifier.setPage('main'),
                child: const Text('← 回到首页'),
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
    this.isTotal = false,
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
            style: TextStyle(
              fontSize: isTotal ? 40 : 26,
              fontWeight: FontWeight.w700,
              color: isTotal ? AppTheme.accent : AppTheme.text,
            ),
          ),
        ],
      ),
    );
  }
}
