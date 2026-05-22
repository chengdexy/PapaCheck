import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/app_provider.dart';
import '../theme/app_theme.dart';

/// 积分商店页面
class ShopPage extends ConsumerWidget {
  const ShopPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.watch(appStateProvider.notifier);
    final items = notifier.state.shopItems;
    final balance = notifier.state.pointsBalance;

    return Scaffold(
      backgroundColor: Colors.black54,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 960),
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
              Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back),
                    onPressed: () => notifier.setPage('main'),
                  ),
                  const Expanded(
                    child: Text(
                      '🏪 积分商店',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.text,
                      ),
                    ),
                  ),
                  Text(
                    '余额: $balance',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.warning,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Expanded(
                child: items.isEmpty
                    ? const Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '商店暂无商品',
                              style: TextStyle(
                                  color: AppTheme.textSecondary, fontSize: 18),
                            ),
                            SizedBox(height: 8),
                            Text(
                              '等待爸爸添加',
                              style: TextStyle(
                                  color: AppTheme.textSecondary, fontSize: 14),
                            ),
                          ],
                        ),
                      )
                    : GridView.builder(
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 4,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                          childAspectRatio: 0.85,
                        ),
                        itemCount: items.length,
                        itemBuilder: (_, i) {
                          final item = items[i] as Map<String, dynamic>;
                          final pts = (item['points'] as int?) ?? 0;
                          final qty = (item['quantity'] as int?) ??
                              (item['remainingQuantity'] as int?) ??
                              0;
                          final canAfford = balance >= pts && qty > 0;
                          final isSoldOut = qty <= 0;
                          final icon = item['icon'] ?? '';
                          final type = item['type'] ?? '';

                          final card = Container(
                            decoration: BoxDecoration(
                              color: AppTheme.bg,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: Colors.transparent,
                                width: 2,
                              ),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      if (icon.isNotEmpty)
                                        Text(icon,
                                            style:
                                                const TextStyle(fontSize: 48)),
                                      const SizedBox(height: 6),
                                      Text(
                                        item['name'] ?? '',
                                        style: const TextStyle(
                                          fontSize: 22,
                                          fontWeight: FontWeight.w600,
                                          color: AppTheme.text,
                                        ),
                                        textAlign: TextAlign.center,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      if (type.isNotEmpty) ...[
                                        const SizedBox(height: 2),
                                        Text(
                                          type,
                                          style: const TextStyle(
                                            fontSize: 14,
                                            color: AppTheme.textSecondary,
                                          ),
                                        ),
                                      ],
                                      const SizedBox(height: 6),
                                      Text(
                                        '$pts 积分',
                                        style: const TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.w600,
                                          color: AppTheme.warning,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  SizedBox(
                                    width: double.infinity,
                                    child: ElevatedButton(
                                      onPressed: canAfford
                                          ? () => _confirmRedeem(
                                              context, item, notifier)
                                          : null,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: AppTheme.accent,
                                        foregroundColor: AppTheme.bg,
                                        disabledBackgroundColor:
                                            AppTheme.accent.withAlpha(60),
                                        disabledForegroundColor:
                                            AppTheme.bg.withAlpha(100),
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 8),
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(10),
                                        ),
                                        textStyle: const TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                      child: Text(isSoldOut ? '售罄' : '兑换'),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );

                          if (isSoldOut) {
                            return Opacity(
                              opacity: 0.4,
                              child: card,
                            );
                          }

                          return card;
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _confirmRedeem(
    BuildContext context,
    Map<String, dynamic> item,
    AppStateNotifier notifier,
  ) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.card,
        title: const Text('确认兑换', style: TextStyle(color: AppTheme.text)),
        content: Text(
          '确定用 ${item['points']} 积分兑换「${item['name']}」吗？',
          style: const TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              notifier.redeemItem(item);
            },
            child: const Text('确认兑换'),
          ),
        ],
      ),
    );
  }
}
