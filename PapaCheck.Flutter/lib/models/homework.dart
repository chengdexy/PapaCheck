
class DeferRequest {
  String? requestedAt;
  String status;
  DeferRequest({this.requestedAt, this.status = 'pending'});

  factory DeferRequest.fromJson(Map<String, dynamic> json) => DeferRequest(
        requestedAt: json['requestedAt'],
        status: json['status'] ?? 'pending',
      );

  Map<String, dynamic> toJson() => {
        'requestedAt': requestedAt,
        'status': status,
      };
}

class Homework {
  final String id;
  String subject;
  String content;
  int suggestedDuration;
  int basePoints;
  String status;
  String mode;
  String? startedAt;
  String? completedAt;
  int? actualDuration;
  bool rejected;
  bool paused;
  bool wasPaused;
  int? pausedElapsed;
  DeferRequest? deferRequest;
  String? animClass;

  Homework({
    required this.id,
    required this.subject,
    required this.content,
    this.suggestedDuration = 20,
    this.basePoints = 10,
    this.status = 'pending',
    this.mode = 'timer',
    this.startedAt,
    this.completedAt,
    this.actualDuration,
    this.rejected = false,
    this.paused = false,
    this.wasPaused = false,
    this.pausedElapsed,
    this.deferRequest,
    this.animClass,
  });

  factory Homework.fromJson(Map<String, dynamic> json) => Homework(
        id: json['id'] ?? '',
        subject: json['subject'] ?? '',
        content: json['content'] ?? '',
        suggestedDuration: json['suggestedDuration'] ?? 20,
        basePoints: json['basePoints'] ?? 10,
        status: json['status'] ?? 'pending',
        mode: json['mode'] ?? 'timer',
        startedAt: json['startedAt'],
        completedAt: json['completedAt'],
        actualDuration: json['actualDuration'],
        rejected: json['rejected'] ?? false,
        paused: json['paused'] ?? false,
        wasPaused: json['wasPaused'] ?? false,
        pausedElapsed: json['_pausedElapsed'],
        deferRequest: json['deferRequest'] != null
            ? DeferRequest.fromJson(json['deferRequest'])
            : null,
        animClass: json['_animClass'],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'subject': subject,
        'content': content,
        'suggestedDuration': suggestedDuration,
        'basePoints': basePoints,
        'status': status,
        'mode': mode,
        'startedAt': startedAt,
        'completedAt': completedAt,
        'actualDuration': actualDuration,
        'rejected': rejected,
        'paused': paused,
        'wasPaused': wasPaused,
        '_pausedElapsed': pausedElapsed,
        'deferRequest': deferRequest?.toJson(),
        '_animClass': animClass,
      };

  bool get isActive => status == 'doing';
  bool get isDone => status == 'done';
  bool get isPending => status == 'pending';
  bool get isChallenge => mode == 'challenge';
  bool get isDeferPending =>
      deferRequest != null && deferRequest!.status == 'pending';
}