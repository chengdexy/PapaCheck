
class AppData {
  final Map<String, List<dynamic>> homeworks;
  final Map<String, List<dynamic>> freeTimeTasks;
  final Map<String, dynamic> dailySettlement;
  final List<dynamic> shopItems;
  final List<dynamic> rewardBox;
  final List<dynamic> redemptions;
  final List<dynamic> activeBuffs;
  final Map<String, dynamic> settings;
  final Map<String, dynamic> points;
  final bool isServerMode;
  final bool isLoaded;
  final String currentPage;
  final bool isScreensaverActive;
  final DateTime lastTick;

  AppData({
    this.homeworks = const {},
    this.freeTimeTasks = const {},
    this.dailySettlement = const {},
    this.shopItems = const [],
    this.rewardBox = const [],
    this.redemptions = const [],
    this.activeBuffs = const [],
    this.settings = const {},
    this.points = const {},
    this.isServerMode = false,
    this.isLoaded = false,
    this.currentPage = 'main',
    this.isScreensaverActive = false,
    DateTime? lastTick,
  }) : lastTick = lastTick ?? DateTime.now();

  factory AppData.empty() => AppData();

  int get pointsBalance {
    final p = points;
    return (p['balance'] as int?) ?? 0;
  }

  AppData copyWith({
    Map<String, List<dynamic>>? homeworks,
    Map<String, List<dynamic>>? freeTimeTasks,
    Map<String, dynamic>? dailySettlement,
    List<dynamic>? shopItems,
    List<dynamic>? rewardBox,
    List<dynamic>? redemptions,
    List<dynamic>? activeBuffs,
    Map<String, dynamic>? settings,
    Map<String, dynamic>? points,
    bool? isServerMode,
    bool? isLoaded,
    String? currentPage,
    bool? isScreensaverActive,
    DateTime? lastTick,
  }) {
    return AppData(
      homeworks: homeworks ?? this.homeworks,
      freeTimeTasks: freeTimeTasks ?? this.freeTimeTasks,
      dailySettlement: dailySettlement ?? this.dailySettlement,
      shopItems: shopItems ?? this.shopItems,
      rewardBox: rewardBox ?? this.rewardBox,
      redemptions: redemptions ?? this.redemptions,
      activeBuffs: activeBuffs ?? this.activeBuffs,
      settings: settings ?? this.settings,
      points: points ?? this.points,
      isServerMode: isServerMode ?? this.isServerMode,
      isLoaded: isLoaded ?? this.isLoaded,
      currentPage: currentPage ?? this.currentPage,
      isScreensaverActive: isScreensaverActive ?? this.isScreensaverActive,
      lastTick: lastTick ?? this.lastTick,
    );
  }
}
