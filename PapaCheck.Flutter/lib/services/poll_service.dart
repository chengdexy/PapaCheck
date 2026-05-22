import 'dart:async';
import 'dart:convert';
import 'api_service.dart';
import 'voice_service.dart';
import '../models/homework.dart';

/// 轮询服务（对应 web 端 pollServer）
/// 每 5 秒拉取全量数据，diff 检测变化
class PollService {
  final ApiService _api = ApiService();
  final VoiceService _voice;
  Timer? _timer;

  // 上次状态快照
  List<dynamic>? _lastBuffs;
  List<dynamic>? _lastRewardBox;
  Map<String, dynamic>? _lastRatingInfo;
  int? _lastPoints;
  List<Homework>? _lastHomeworks;
  Map<String, dynamic>? _lastSettings;

  // 回调：数据变化时通知 UI
  void Function(Map<String, dynamic> data)? onDataChanged;
  // 回调：需要全量渲染
  void Function()? onFullRender;

  PollService(this._voice);

  void start(int intervalMs) {
    stop();
    _timer = Timer.periodic(Duration(milliseconds: intervalMs), (_) => _poll());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _poll() async {
    try {
      final data = await _api.getData();
      if (data == null) return;

      bool needsFullRender = false;

      // 检查 Buff 变化
      final buffs = (data['activeBuffs'] as List<dynamic>?) ?? [];
      bool buffsChanged = false;
      final now = DateTime.now();
      final remaining = <dynamic>[];
      for (final b in buffs) {
        if (b is Map<String, dynamic>) {
          final unit = b['unit'] ?? 'days';
          if (unit == 'minutes') {
            final startTime = b['startDate'] != null
                ? DateTime.tryParse(b['startDate'].toString()) ?? now
                : now;
            final endTime = startTime.add(
              Duration(minutes: (b['duration'] ?? 0) as int),
            );
            if (endTime.isBefore(now)) {
              buffsChanged = true;
            } else {
              remaining.add(b);
            }
          } else {
            final end = b['startDate'] != null
                ? DateTime.tryParse(b['startDate'].toString())
                : now;
            if (end != null) {
              final adjusted = end.add(
                Duration(days: (b['duration'] ?? 1) as int),
              );
              if (adjusted.isBefore(now)) {
                buffsChanged = true;
              } else {
                remaining.add(b);
              }
            }
          }
        }
      }
      if (buffsChanged) {
        await _api.saveActiveBuffs(remaining.cast<Map<String, dynamic>>());
        data['activeBuffs'] = remaining;
        needsFullRender = true;
      }

      if (_lastBuffs != null &&
          jsonEncode(data['activeBuffs']) != jsonEncode(_lastBuffs)) {
        final prevBuffs = _lastBuffs ?? [];
        final newBuffs = (data['activeBuffs'] as List<dynamic>?) ?? [];
        for (final b in newBuffs) {
          if (b is Map<String, dynamic>) {
            final exists = prevBuffs.any(
              (p) =>
                  p is Map &&
                  p['name'] == b['name'] &&
                  p['startDate'] == b['startDate'],
            );
            if (!exists) {
              _voice.speak('${b['name']}已生效');
            }
          }
        }
        _lastBuffs = List.from(newBuffs);
        needsFullRender = true;
      }
      _lastBuffs ??= List.from(buffs);

      // 检查奖励箱变化
      final rb = (data['rewardBox'] as List<dynamic>?) ?? [];
      if (_lastRewardBox != null &&
          jsonEncode(rb) != jsonEncode(_lastRewardBox)) {
        final prev = _lastRewardBox ?? [];
        final added = rb.where((r) {
          if (r is! Map) return false;
          final prevItem = prev.cast<Map?>().firstWhere(
                (p) => p?['name'] == r['name'],
                orElse: () => null,
              );
          if (prevItem == null) return true;
          return (r['quantity'] ?? 0) > (prevItem['quantity'] ?? 0);
        }).toList();
        if (added.isNotEmpty) {
          _voice.speak('奖励箱有新奖励，快去看看吧');
        }
        _lastRewardBox = List.from(rb);
      }
      _lastRewardBox ??= List.from(rb);

      // 检查作业变化（含延后审批）
      final todayKey = _todayKey();
      final newHwRaw = (data['homeworks'] as Map<String, dynamic>?)?[todayKey]
              as List<dynamic>? ??
          [];
      final newHw = newHwRaw
          .map((h) => Homework.fromJson(h as Map<String, dynamic>))
          .toList();

      if (_lastHomeworks != null) {
        final oldDeferred =
            _lastHomeworks!.where((h) => h.isDeferPending).toList();
        for (final dh in oldDeferred) {
          final stillThere = newHw.where((h) => h.id == dh.id).firstOrNull;
          if (stillThere == null) {
            _voice.speak('爸爸批准了${dh.subject}的延后申请，明天再做');
          } else if (!stillThere.isDeferPending) {
            _voice.speak('爸爸拒绝了${dh.subject}的延后申请，今天完成吧');
          }
        }
      }
      _lastHomeworks = newHw;

      // 检查评级变化
      final settlement =
          (data['dailySettlement'] as Map<String, dynamic>?)?[todayKey];
      if (settlement is Map && settlement['rating'] != null) {
        final prevRating = _lastRatingInfo;
        if (_lastRatingInfo == null ||
            _lastRatingInfo!['key'] != todayKey ||
            _lastRatingInfo!['rating'] != settlement['rating']) {
          _lastRatingInfo = {
            'key': todayKey,
            'rating': settlement['rating'],
            'finalPoints': settlement['finalPoints'],
          };
          _voice.speak(
            '爸爸评了${settlement['rating']}，获得${settlement['finalPoints'] ?? 0}分',
          );
          onDataChanged?.call(data);
          needsFullRender = true;
        }
      }

      // 检查积分变化
      final points = (data['points'] as Map<String, dynamic>?)?['balance'] ?? 0;
      if (_lastPoints != null && points != _lastPoints) {
        _voice.speak('积分已更新为$points分');
      }
      _lastPoints = points;

      // 检查 settings 变化
      final settings = data['settings'] ?? {};
      if (_lastSettings != null &&
          jsonEncode(settings) != jsonEncode(_lastSettings)) {
        needsFullRender = true;
      }
      _lastSettings = Map.from(settings);

      if (needsFullRender) {
        onFullRender?.call();
      }
      onDataChanged?.call(data);
    } catch (_) {
      // silently retry
    }
  }

  String _todayKey() {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  void resetState() {
    _lastBuffs = null;
    _lastRewardBox = null;
    _lastRatingInfo = null;
    _lastPoints = null;
    _lastHomeworks = null;
    _lastSettings = null;
  }
}
