
class FreeTimeTask {
  final String id;
  String name;
  int durationMinutes;
  String status;
  String? startedAt;
  String? completedAt;
  int? remainingSeconds;
  bool paused;
  bool wasPaused;
  int? pausedElapsed;

  FreeTimeTask({
    required this.id,
    required this.name,
    this.durationMinutes = 10,
    this.status = 'pending',
    this.startedAt,
    this.completedAt,
    this.remainingSeconds,
    this.paused = false,
    this.wasPaused = false,
    this.pausedElapsed,
  });

  factory FreeTimeTask.fromJson(Map<String, dynamic> json) => FreeTimeTask(
        id: json['id'] ?? '',
        name: json['name'] ?? '',
        durationMinutes: json['durationMinutes'] ?? 10,
        status: json['status'] ?? 'pending',
        startedAt: json['startedAt'],
        completedAt: json['completedAt'],
        remainingSeconds: json['remainingSeconds'],
        paused: json['paused'] ?? false,
        wasPaused: json['wasPaused'] ?? false,
        pausedElapsed: json['_pausedElapsed'],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'durationMinutes': durationMinutes,
        'status': status,
        'startedAt': startedAt,
        'completedAt': completedAt,
        'remainingSeconds': remainingSeconds,
        'paused': paused,
        'wasPaused': wasPaused,
        '_pausedElapsed': pausedElapsed,
      };

  bool get isActive => status == 'doing';
  bool get isDone => status == 'done';
  bool get isPending => status == 'pending';
}