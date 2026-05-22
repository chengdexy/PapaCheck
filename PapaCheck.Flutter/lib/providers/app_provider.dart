import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/homework.dart';
import '../models/free_time_task.dart';
import '../models/app_state.dart';
import '../services/api_service.dart';
import '../services/voice_service.dart';
import '../services/poll_service.dart';
import '../utils/date_utils.dart' as du;

/// 应用全局状态（对应 web 端 app.js 的全局变量 + 所有业务逻辑）
class AppStateNotifier extends StateNotifier<AppData> {
  final ApiService _api = ApiService();
  late final VoiceService voice;
  late final PollService _pollService;

  Timer? _tickTimer;
  Timer? _screensaverTimer;
  bool _submittingRating = false;

  // 提醒状态
  final Map<String, Set<String>> _reminderTrigger = {};
  final Map<String, int> _overtimeSpeak = {};
  final Map<String, Set<String>> _ftReminderTrigger = {};
  final Map<String, int> _ftOvertimeSpeak = {};

  // 当前日期
  DateTime currentDate = DateTime.now();

  // 页面状态
  String get currentPage => state.currentPage;
  bool get isScreensaverActive => state.isScreensaverActive;

  // 结算数据
  Map<String, dynamic>? _settlement;

  // 回调
  void Function()? onPageChanged;
  void Function(String msg)? onToast;

  AppStateNotifier() : super(AppData.empty()) {
    voice = VoiceService();
    _pollService = PollService(voice);
    _pollService.onDataChanged = _onPollDataChanged;
    _pollService.onFullRender = _onFullRender;
  }

  void _onPollDataChanged(Map<String, dynamic> data) {
    state = AppData(
      homeworks:
          (data['homeworks'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, v as List<dynamic>),
          ) ??
          {},
      freeTimeTasks:
          (data['freeTimeTasks'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, v as List<dynamic>),
          ) ??
          {},
      dailySettlement: (data['dailySettlement'] as Map<String, dynamic>?) ?? {},
      shopItems: (data['shopItems'] as List<dynamic>?) ?? [],
      rewardBox: (data['rewardBox'] as List<dynamic>?) ?? [],
      redemptions: (data['redemptions'] as List<dynamic>?) ?? [],
      activeBuffs: (data['activeBuffs'] as List<dynamic>?) ?? [],
      settings: (data['settings'] as Map<String, dynamic>?) ?? {},
      points: (data['points'] as Map<String, dynamic>?) ?? {},
      isServerMode: true,
      isLoaded: true,
      currentPage: state.currentPage,
      isScreensaverActive: state.isScreensaverActive,
    );
  }

  void _onFullRender() {
    // full render handled by Riverpod rebuild
  }

  /// 初始化：加载数据 + 启动轮询 + 启动时钟
  Future<void> init() async {
    final data = await _api.getData();
    if (data != null) {
      _onPollDataChanged(data);
    } else {
      state = state.copyWith(isLoaded: true);
    }
    _pollService.start(5000);
    _startTickTimer();
    _resetScreensaverTimer();
  }

  /// 获取当天作业列表
  List<Homework> get homeworks {
    final key = du.dateKey(currentDate);
    final list = state.homeworks[key] ?? [];
    return list
        .map((h) => Homework.fromJson(h as Map<String, dynamic>))
        .toList();
  }

  /// 获取当天自由时间任务
  List<FreeTimeTask> get freeTimeTasks {
    final key = du.dateKey(currentDate);
    final list = state.freeTimeTasks[key] ?? [];
    return list
        .map((ft) => FreeTimeTask.fromJson(ft as Map<String, dynamic>))
        .toList();
  }

  /// 获取活跃任务
  Homework? get activeHomework =>
      homeworks.where((h) => h.isActive).firstOrNull;

  FreeTimeTask? get activeFreeTime =>
      freeTimeTasks.where((ft) => ft.isActive).firstOrNull;

  bool get isAnyTaskActive => activeHomework != null || activeFreeTime != null;

  bool get isAnyTaskPaused {
    final t = activeHomework ?? activeFreeTime;
    return t != null && t is Homework
        ? (t as Homework).paused
        : (t as FreeTimeTask?)?.paused ?? false;
  }

  dynamic get activeTask => activeHomework ?? activeFreeTime;

  /// 获取结算数据
  Map<String, dynamic>? get settlementData {
    final key = du.dateKey(currentDate);
    return state.dailySettlement[key] as Map<String, dynamic>?;
  }

  /// 判断明天是否假日
  bool isTomorrowHoliday() {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    if (tomorrow.weekday == DateTime.sunday ||
        tomorrow.weekday == DateTime.saturday)
      return true;
    final holidays = (state.settings['customHolidays'] as List<dynamic>?) ?? [];
    final key = du.dateKey(tomorrow);
    return holidays.contains(key);
  }

  // ========== 计时器 ==========
  void _startTickTimer() {
    _tickTimer?.cancel();
    _tickTimer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    final now = DateTime.now();
    currentDate = now;
    if (isAnyTaskPaused) return;
    final hw = activeHomework;
    if (hw != null) _checkReminders(hw);
    final ft = activeFreeTime;
    if (ft != null) _checkFreeTimeReminders(ft);
    state = state.copyWith(lastTick: now);
  }

  void _resetScreensaverTimer() {
    _screensaverTimer?.cancel();
    if (state.isScreensaverActive) return;
    _screensaverTimer = Timer(const Duration(seconds: 60), () {
      state = state.copyWith(isScreensaverActive: true);
    });
  }

  void wakeUp() {
    _resetScreensaverTimer();
    state = state.copyWith(isScreensaverActive: false);
  }

  // ========== 原始数据操作辅助 ==========
  String get _todayKey => du.dateKey(currentDate);

  List<Map<String, dynamic>> _copyRawHomeworkList() {
    final raw = state.homeworks[_todayKey] ?? [];
    return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  List<Map<String, dynamic>> _copyRawFreeTimeList() {
    final raw = state.freeTimeTasks[_todayKey] ?? [];
    return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  void _commitHomeworks(List<Map<String, dynamic>> list) {
    final newMap = Map<String, List<dynamic>>.from(state.homeworks);
    newMap[_todayKey] = list;
    state = state.copyWith(homeworks: newMap);
  }

  void _commitFreeTime(List<Map<String, dynamic>> list) {
    final newMap = Map<String, List<dynamic>>.from(state.freeTimeTasks);
    newMap[_todayKey] = list;
    state = state.copyWith(freeTimeTasks: newMap);
  }

  // ========== 开始作业 ==========
  void startHomework(String id, {String mode = 'challenge'}) {
    if (isAnyTaskActive) {
      onToast?.call('请先完成当前任务');
      return;
    }
    final list = _copyRawHomeworkList();
    final idx = list.indexWhere((h) => h['id'] == id);
    if (idx == -1 || list[idx]['status'] != 'pending') return;

    final effectiveMode = (list[idx]['rejected'] == true) ? 'timer' : mode;
    list[idx]['mode'] = effectiveMode;
    list[idx]['status'] = 'doing';
    list[idx]['startedAt'] = DateTime.now().toIso8601String();
    _commitHomeworks(list);
    _api.saveHomeworks(_todayKey, list);

    final hw = list[idx];
    if (effectiveMode == 'challenge') {
      voice.speak('开始${hw['content']}，挑战${hw['suggestedDuration']}分钟');
    } else {
      voice.speak('开始${hw['content']}');
    }
    _startTickTimer();
    _resetScreensaverTimer();
  }

  /// 完成作业
  Future<void> completeHomework(String id) async {
    final list = _copyRawHomeworkList();
    final idx = list.indexWhere((h) => h['id'] == id);
    if (idx == -1 || list[idx]['status'] != 'doing') return;
    if (list[idx]['paused'] == true) {
      onToast?.call('请先继续任务再完成');
      return;
    }

    final completedAt = DateTime.now();
    final startedAt =
        DateTime.tryParse(list[idx]['startedAt'] ?? '') ?? completedAt;
    final actualDuration =
        (completedAt.difference(startedAt).inMinutes).clamp(1, 999);
    final suggestedDuration = (list[idx]['suggestedDuration'] as int?) ?? 20;

    list[idx]['status'] = 'done';
    list[idx]['completedAt'] = completedAt.toIso8601String();
    list[idx]['actualDuration'] = actualDuration;

    final isChallenge = list[idx]['mode'] == 'challenge';
    final subject = list[idx]['subject'] ?? '';

    if (isChallenge && suggestedDuration > 0 && actualDuration > suggestedDuration) {
      list[idx]['mode'] = 'timer';
      voice.speak('超时了，本次按计时模式统计，${subject}作业完成');
    } else if (isChallenge) {
      voice.speak('挑战成功！${subject}提前完成');
    } else {
      voice.speak('${subject}作业完成！');
    }

    _tickTimer?.cancel();
    _tickTimer = null;
    _commitHomeworks(list);
    await _api.saveHomeworks(_todayKey, list);
    await _checkAllDone();
    _resetScreensaverTimer();
  }

  /// 开始自由时间
  void startFreeTime(String id) {
    if (isAnyTaskActive) {
      onToast?.call('请先完成当前任务');
      return;
    }
    final list = _copyRawFreeTimeList();
    final idx = list.indexWhere((t) => t['id'] == id);
    if (idx == -1 || list[idx]['status'] != 'pending') return;

    list[idx]['status'] = 'doing';
    list[idx]['startedAt'] = DateTime.now().toIso8601String();
    list[idx]['remainingSeconds'] = (list[idx]['durationMinutes'] as int) * 60;
    _commitFreeTime(list);
    _api.saveFreeTime(_todayKey, list);

    final ft = list[idx];
    voice.speak('开始${ft['name']}，${ft['durationMinutes']}分钟');
    _startTickTimer();
    _resetScreensaverTimer();
  }

  /// 完成自由时间
  Future<void> completeFreeTime(String id) async {
    final list = _copyRawFreeTimeList();
    final idx = list.indexWhere((t) => t['id'] == id);
    if (idx == -1 || list[idx]['status'] != 'doing') return;
    if (list[idx]['paused'] == true) {
      onToast?.call('请先继续任务再完成');
      return;
    }

    list[idx]['status'] = 'done';
    list[idx]['completedAt'] = DateTime.now().toIso8601String();
    list[idx]['remainingSeconds'] = 0;

    _tickTimer?.cancel();
    _tickTimer = null;
    voice.speak('${list[idx]['name']}时间到！');
    _commitFreeTime(list);
    await _api.saveFreeTime(_todayKey, list);
    _resetScreensaverTimer();
  }

  /// 暂停任务
  Future<void> pauseActiveTask() async {
    final Hw = activeHomework;
    final Ft = activeFreeTime;
    if (Hw == null && Ft == null) return;

    final startedAtStr = (Hw?.startedAt ?? Ft?.startedAt) ?? '';
    final startedAt =
        DateTime.tryParse(startedAtStr) ?? DateTime.now();
    final pausedElapsed = DateTime.now().difference(startedAt).inSeconds;

    _tickTimer?.cancel();
    _tickTimer = null;
    voice.speak('任务已暂停');

    if (Hw != null) {
      final list = _copyRawHomeworkList();
      final idx = list.indexWhere((h) => h['id'] == Hw.id);
      if (idx == -1) return;
      list[idx]['paused'] = true;
      list[idx]['wasPaused'] = true;
      list[idx]['_pausedElapsed'] = pausedElapsed;
      _commitHomeworks(list);
      await _api.saveHomeworks(_todayKey, list);
    } else if (Ft != null) {
      final list = _copyRawFreeTimeList();
      final idx = list.indexWhere((t) => t['id'] == Ft.id);
      if (idx == -1) return;
      list[idx]['paused'] = true;
      list[idx]['wasPaused'] = true;
      list[idx]['_pausedElapsed'] = pausedElapsed;
      _commitFreeTime(list);
      await _api.saveFreeTime(_todayKey, list);
    }
    _resetScreensaverTimer();
  }

  /// 继续任务
  Future<void> resumeActiveTask() async {
    final Hw = activeHomework;
    final Ft = activeFreeTime;
    if (Hw == null && Ft == null) return;

    if (Hw != null) {
      final list = _copyRawHomeworkList();
      final idx = list.indexWhere((h) => h['id'] == Hw.id);
      if (idx == -1) return;
      list[idx]['paused'] = false;
      final pausedElapsed = list[idx]['_pausedElapsed'] as int?;
      if (pausedElapsed != null) {
        list[idx]['startedAt'] = DateTime.now()
            .subtract(Duration(seconds: pausedElapsed))
            .toIso8601String();
        list[idx]['_pausedElapsed'] = null;
      }
      _commitHomeworks(list);
      await _api.saveHomeworks(_todayKey, list);
    } else if (Ft != null) {
      final list = _copyRawFreeTimeList();
      final idx = list.indexWhere((t) => t['id'] == Ft.id);
      if (idx == -1) return;
      list[idx]['paused'] = false;
      final pausedElapsed = list[idx]['_pausedElapsed'] as int?;
      if (pausedElapsed != null) {
        list[idx]['startedAt'] = DateTime.now()
            .subtract(Duration(seconds: pausedElapsed))
            .toIso8601String();
        list[idx]['_pausedElapsed'] = null;
      }
      _commitFreeTime(list);
      await _api.saveFreeTime(_todayKey, list);
    }

    voice.speak('任务已继续');
    _startTickTimer();
    _resetScreensaverTimer();
  }

  // ========== 语音提醒 ==========
  void _checkReminders(Homework hw) {
    if (!hw.isChallenge || !hw.isActive || hw.startedAt == null) return;

    final startedAt = DateTime.tryParse(hw.startedAt!) ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
    final totalSeconds = hw.suggestedDuration * 60;

    final key = hw.id;
    _reminderTrigger.putIfAbsent(key, () => <String>{});

    if (!_reminderTrigger[key]!.contains('half') &&
        elapsedSeconds >= totalSeconds * 0.5) {
      _reminderTrigger[key]!.add('half');
      voice.speak('已用${hw.suggestedDuration ~/ 2}分钟，继续加油');
    }

    if (!_reminderTrigger[key]!.contains('fiveMin') &&
        totalSeconds - elapsedSeconds <= 300 &&
        elapsedSeconds < totalSeconds) {
      _reminderTrigger[key]!.add('fiveMin');
      voice.speak('还剩5分钟');
    }

    if (!_reminderTrigger[key]!.contains('oneMin') &&
        totalSeconds - elapsedSeconds <= 60 &&
        elapsedSeconds < totalSeconds) {
      _reminderTrigger[key]!.add('oneMin');
      voice.speak('还剩1分钟');
    }

    if (!_reminderTrigger[key]!.contains('overtime') &&
        elapsedSeconds > totalSeconds) {
      _reminderTrigger[key]!.add('overtime');
      voice.speak('已超时，请尽快完成');
      _overtimeSpeak[key] = DateTime.now().millisecondsSinceEpoch;
    }

    if (_reminderTrigger[key]!.contains('overtime') &&
        elapsedSeconds > totalSeconds) {
      final lastSpeak = _overtimeSpeak[key] ?? 0;
      if (DateTime.now().millisecondsSinceEpoch - lastSpeak >= 30 * 60 * 1000) {
        voice.speak('已超时，请尽快完成');
        _overtimeSpeak[key] = DateTime.now().millisecondsSinceEpoch;
      }
    }
  }

  void _checkFreeTimeReminders(FreeTimeTask ft) {
    if (!ft.isActive || ft.startedAt == null) return;

    final startedAt = DateTime.tryParse(ft.startedAt!) ?? DateTime.now();
    final elapsedSeconds = DateTime.now().difference(startedAt).inSeconds;
    final totalSeconds = ft.durationMinutes * 60;

    final key = ft.id;
    _ftReminderTrigger.putIfAbsent(key, () => <String>{});

    if (!_ftReminderTrigger[key]!.contains('half') &&
        elapsedSeconds >= totalSeconds * 0.5) {
      _ftReminderTrigger[key]!.add('half');
      voice.speak('${ft.name}已进行${ft.durationMinutes ~/ 2}分钟');
    }

    if (!_ftReminderTrigger[key]!.contains('fiveMin') &&
        totalSeconds - elapsedSeconds <= 300 &&
        elapsedSeconds < totalSeconds) {
      _ftReminderTrigger[key]!.add('fiveMin');
      voice.speak('${ft.name}还剩5分钟');
    }

    if (!_ftReminderTrigger[key]!.contains('oneMin') &&
        totalSeconds - elapsedSeconds <= 60 &&
        elapsedSeconds < totalSeconds) {
      _ftReminderTrigger[key]!.add('oneMin');
      voice.speak('${ft.name}还剩1分钟');
    }

    if (!_ftReminderTrigger[key]!.contains('overtime') &&
        elapsedSeconds > totalSeconds) {
      _ftReminderTrigger[key]!.add('overtime');
      voice.speak('${ft.name}时间到，请结束任务');
      _ftOvertimeSpeak[key] = DateTime.now().millisecondsSinceEpoch;
    }

    if (_ftReminderTrigger[key]!.contains('overtime') &&
        elapsedSeconds > totalSeconds) {
      final lastSpeak = _ftOvertimeSpeak[key] ?? 0;
      if (DateTime.now().millisecondsSinceEpoch - lastSpeak >= 30 * 60 * 1000) {
        voice.speak('${ft.name}时间到，请结束任务');
        _ftOvertimeSpeak[key] = DateTime.now().millisecondsSinceEpoch;
      }
    }
  }

  // ========== 结算 ==========
  Future<void> _checkAllDone() async {
    final hwList = homeworks;
    if (hwList.isEmpty) return;
    if (hwList.every((h) => h.isDone)) {
      await _calculateSettlement();
    }
  }

  Future<void> _calculateSettlement() async {
    final hwList = homeworks;
    final challengeHw = hwList
        .where((h) => h.isChallenge && h.isDone && !h.rejected)
        .toList();
    final doneHw = hwList.where((h) => h.isDone).toList();

    final basePoints = doneHw.fold<int>(0, (sum, h) => sum + (h.basePoints));
    int efficiencyBonus = 0;
    final ratios = <double>[];
    final bonusPerTask =
        (state.settings['challengeEfficiencyBonus'] as int?) ?? 5;

    for (final hw in challengeHw) {
      if (hw.actualDuration != null && hw.suggestedDuration > 0) {
        final ratio = hw.actualDuration! / hw.suggestedDuration;
        ratios.add(ratio);
        if (ratio <= 0.8) efficiencyBonus += bonusPerTask;
      }
    }

    _settlement = {
      'basePoints': basePoints,
      'efficiencyBonus': efficiencyBonus,
      'totalBeforeRating': basePoints + efficiencyBonus,
      'challengeCount': challengeHw.length,
      'timerCount': doneHw.where((h) => h.mode == 'timer').length,
    };

    final key = du.dateKey(currentDate);
    await _api.saveSettlement(key, {
      ..._settlement!,
      'rating': null,
      'multiplier': null,
      'finalPoints': null,
      'submittedAt': null,
      'ratedAt': null,
    });

    await _api.saveEfficiency(key, {
      'averageRatio': ratios.isEmpty
          ? 0
          : ratios.reduce((a, b) => a + b) / ratios.length,
      'ratios': ratios,
    });

    state = state.copyWith(currentPage: 'settlement');
    onPageChanged?.call();
  }

  /// 提交评级
  Future<void> submitForRating() async {
    if (_submittingRating || _settlement == null) return;
    _submittingRating = true;
    try {
      final key = du.dateKey(currentDate);
      await _api.saveSettlement(key, {
        ..._settlement!,
        'rating': null,
        'multiplier': null,
        'finalPoints': null,
        'submittedAt': du.nowTimeStr(),
        'ratedAt': null,
      });
      onToast?.call('已提交给爸爸评级');
    } finally {
      _submittingRating = false;
    }
  }

  /// 延后申请
  Future<void> requestDefer(String hwId) async {
    final list = _copyRawHomeworkList();
    final idx = list.indexWhere((h) => h['id'] == hwId);
    if (idx == -1) return;
    list[idx]['deferRequest'] = {
      'requestedAt': DateTime.now().toIso8601String(),
      'status': 'pending',
    };
    _commitHomeworks(list);
    await _api.deferHomework(_todayKey, hwId, 'request');
    await _api.saveHomeworks(_todayKey, list);
    voice.speak('已申请将${list[idx]['content']}延后到明天');
  }

  /// 兑换商品
  Future<void> redeemItem(Map<String, dynamic> item) async {
    final shopItems = List<Map<String, dynamic>>.from(
      state.shopItems.map((e) => Map<String, dynamic>.from(e as Map)),
    );
    final idx = shopItems.indexWhere((s) => s['id'] == item['id']);
    if (idx == -1 || shopItems[idx]['quantity'] <= 0) {
      onToast?.call('该商品已售罄');
      return;
    }

    final points = item['points'] as int;
    final balance = state.pointsBalance;
    if (balance < points) {
      onToast?.call('积分不足');
      return;
    }

    shopItems[idx]['quantity'] = (shopItems[idx]['quantity'] as int) - 1;
    await _api.updatePoints('spend', points, '兑换：${item['name']}');
    await _api.saveShopItems(shopItems);

    final rewardBox = List<Map<String, dynamic>>.from(
      state.rewardBox.map((e) => Map<String, dynamic>.from(e as Map)),
    );
    final existingIdx = rewardBox.indexWhere((r) => r['name'] == item['name']);
    if (existingIdx >= 0) {
      rewardBox[existingIdx]['quantity'] =
          (rewardBox[existingIdx]['quantity'] as int) + 1;
    } else {
      rewardBox.add({
        'id': du.genId(),
        'name': item['name'],
        'quantity': 1,
        'source': 'shop',
      });
    }
    await _api.saveRewardBox(rewardBox);
    onToast?.call('已兑换：${item['name']}');
  }

  void setPage(String page) {
    state = state.copyWith(currentPage: page);
  }

  @override
  void dispose() {
    _tickTimer?.cancel();
    _screensaverTimer?.cancel();
    _pollService.stop();
    voice.dispose();
    super.dispose();
  }
}

/// Riverpod Provider
final appStateProvider = StateNotifierProvider<AppStateNotifier, AppData>((
  ref,
) {
  return AppStateNotifier();
});
