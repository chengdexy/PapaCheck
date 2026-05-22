import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/app_provider.dart';
import '../models/homework.dart';
import '../models/free_time_task.dart';
import '../widgets/clock_header.dart';
import '../widgets/current_task_card.dart';
import '../widgets/homework_card.dart';
import '../widgets/free_time_card.dart';
import '../widgets/buff_bar.dart';
import '../widgets/stats_bar.dart';
import '../widgets/start_confirm_dialog.dart';
import '../widgets/toast_widget.dart';
import '../theme/app_theme.dart';

/// MAIN 主页
class MainPage extends ConsumerStatefulWidget {
  const MainPage({super.key});

  @override
  ConsumerState<MainPage> createState() => _MainPageState();
}

class _MainPageState extends ConsumerState<MainPage> {
  @override
  void initState() {
    super.initState();
    final notifier = ref.read(appStateProvider.notifier);
    notifier.onToast = (msg) {
      if (mounted) {
        _showToast(msg);
      }
    };
  }

  void _showToast(String msg) {
    final overlay = Overlay.of(context);
    late OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) =>
          ToastWidget(message: msg, onDismiss: () => entry.remove()),
    );
    overlay.insert(entry);
    Future.delayed(const Duration(seconds: 3), () {
      if (entry.mounted) entry.remove();
    });
  }

  void _onHomeworkTap(String hwId) {
    final notifier = ref.read(appStateProvider.notifier);
    final hw = notifier.homeworks.firstWhere((h) => h.id == hwId);
    if (hw.isDeferPending) return;

    if (notifier.isAnyTaskActive) {
      _showToast('请先完成当前任务');
      return;
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => StartConfirmDialog(
        homework: hw,
        isTomorrowHoliday: notifier.isTomorrowHoliday(),
        onStart: () {
          notifier.startHomework(hwId, mode: 'challenge');
          Navigator.pop(context);
        },
        onDefer: () {
          notifier.requestDefer(hwId);
          Navigator.pop(context);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final notifier = ref.read(appStateProvider.notifier);
    final hwList = notifier.homeworks;
    final ftList = notifier.freeTimeTasks;

    final activeHw = notifier.activeHomework;
    final activeFt = notifier.activeFreeTime;
    final active = activeHw ?? activeFt;

    final pendingHwList = hwList.where((h) => !h.isDone).toList();
    final doneCount = hwList.where((h) => h.isDone).length;
    final totalCount = hwList.length;
    final points = appState.pointsBalance;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            // 顶部时钟 + 连接状态
            const ClockHeader(),
            const SizedBox(height: 20),
            // 主体：左右两列
            Expanded(
              child: Row(
                children: [
                  // 左列：当前任务 + 统计
                  Expanded(
                    child: Column(
                      children: [
                        Expanded(
                          child: CurrentTaskCard(
                            activeHw: activeHw,
                            activeFt: activeFt,
                            active: active,
                            homeworks: hwList,
                            pointsBalance: appState.pointsBalance,
                            pointsHistory: appState.points,
                          ),
                        ),
                        const SizedBox(height: 20),
                        StatsBar(
                          doneCount: doneCount,
                          totalCount: totalCount,
                          points: points,
                          onShopTap: () => notifier.setPage('shop'),
                          onRewardsTap: () => _showRewardsDialog(),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 20),
                  // 右列：Buff + 作业 + 自由时间
                  Expanded(
                    child: Column(
                      children: [
                        BuffBar(buffs: appState.activeBuffs),
                        if (appState.activeBuffs.isNotEmpty)
                          const SizedBox(height: 20),
                        Expanded(
                          child: _SectionCard(
                            title: '📝 今日作业',
                            child: ListView(
                              shrinkWrap: true,
                              children: pendingHwList
                                  .map(
                                    (hw) => Padding(
                                      padding: const EdgeInsets.only(
                                        bottom: 10,
                                      ),
                                      child: HomeworkCard(
                                        homework: hw,
                                        onTap: hw.isPending
                                            ? () => _onHomeworkTap(hw.id)
                                            : null,
                                      ),
                                    ),
                                  )
                                  .toList(),
                            ),
                          ),
                        ),
                        if (ftList.where((ft) => !ft.isDone).isNotEmpty) ...[
                          const SizedBox(height: 20),
                          _SectionCard(
                            title: '🎮 奖励时间',
                            child: ListView(
                              shrinkWrap: true,
                              children: ftList
                                  .map(
                                    (ft) => Padding(
                                      padding: const EdgeInsets.only(
                                        bottom: 10,
                                      ),
                                      child: FreeTimeCard(
                                        task: ft,
                                        onTap: ft.isPending
                                            ? () => notifier.startFreeTime(
                                                  ft.id,
                                                )
                                            : null,
                                      ),
                                    ),
                                  )
                                  .toList(),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // 操作栏：暂停/继续/完成
            if (active != null) _buildActionBar(notifier, active),
          ],
        ),
      ),
    );
  }

  Widget _buildActionBar(AppStateNotifier notifier, dynamic active) {
    if (active == null) return const SizedBox.shrink();
    final isPaused =
        active is Homework ? (active).paused : (active as FreeTimeTask).paused;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      margin: const EdgeInsets.only(top: 10),
      decoration: const BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(20),
          topRight: Radius.circular(20),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (isPaused)
            ElevatedButton(
              onPressed: () => notifier.resumeActiveTask(),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accent,
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                textStyle: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              child: const Text('继续'),
            )
          else
            ElevatedButton(
              onPressed: () => notifier.pauseActiveTask(),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0x26FACC15),
                foregroundColor: const Color(0xFFFACC15),
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                  side: const BorderSide(color: Color(0x4DFACC15)),
                ),
                textStyle: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              child: const Text('暂停'),
            ),
          const SizedBox(width: 10),
          ElevatedButton(
            onPressed: () {
              if (notifier.activeHomework != null) {
                notifier.completeHomework(notifier.activeHomework!.id);
              } else if (notifier.activeFreeTime != null) {
                notifier.completeFreeTime(notifier.activeFreeTime!.id);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.success,
              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              textStyle: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            ),
            child: const Text('完成'),
          ),
        ],
      ),
    );
  }

  void _showRewardsDialog() {
    showDialog(
      context: context,
      builder: (ctx) {
        final notifier = ref.read(appStateProvider.notifier);
        final rewards = notifier.state.rewardBox;
        return AlertDialog(
          backgroundColor: AppTheme.card,
          title: const Row(
            children: [
              Text('🎁', style: TextStyle(fontSize: 24)),
              SizedBox(width: 8),
              Text('我的奖励',
                  style: TextStyle(color: AppTheme.text, fontSize: 20)),
            ],
          ),
          content: SizedBox(
            width: 400,
            child: rewards.isEmpty
                ? const Text(
                    '还没有兑换的奖励',
                    style:
                        TextStyle(color: AppTheme.textSecondary, fontSize: 16),
                  )
                : ListView.builder(
                    shrinkWrap: true,
                    itemCount: rewards.length,
                    itemBuilder: (_, i) {
                      final item = rewards[i] as Map;
                      final name = item['name'] ?? '';
                      final qty = item['quantity'] ?? 1;
                      final source = item['source'] ?? '';
                      final status = item['status'] ?? 'pending';

                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppTheme.bg,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '$name',
                                    style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w600,
                                      color: AppTheme.text,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    source == 'shop' ? '积分商店兑换' : '来源：$source',
                                    style: const TextStyle(
                                      fontSize: 14,
                                      color: AppTheme.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (status != 'fulfilled')
                              ElevatedButton(
                                onPressed: () {
                                  notifier.setPage('main');
                                  Navigator.pop(ctx);
                                  notifier.onToast?.call('已使用：$name');
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppTheme.accent,
                                  foregroundColor: AppTheme.bg,
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 16, vertical: 8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  textStyle: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                child: const Text('使用'),
                              ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 4),
                              decoration: BoxDecoration(
                                color: status == 'fulfilled'
                                    ? AppTheme.success.withAlpha(40)
                                    : AppTheme.warning.withAlpha(40),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                status == 'fulfilled' ? '已使用' : '待使用',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: status == 'fulfilled'
                                      ? AppTheme.success
                                      : AppTheme.warning,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'x$qty',
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                color: AppTheme.accent,
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('关闭'),
            ),
          ],
        );
      },
    );
  }
}

/// 区域卡片容器
class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _SectionCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
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
          Text(
            title,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              color: AppTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}
