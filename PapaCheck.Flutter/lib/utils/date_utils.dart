String dateKey(DateTime d) {
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String formatDate(DateTime d) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return '${d.year}年${d.month}月${d.day}日 星期${weekdays[d.weekday % 7]}';
}

String formatDuration(int totalSeconds) {
  final m = totalSeconds ~/ 60;
  final s = totalSeconds % 60;
  if (m == 0) return '$s秒';
  if (s == 0) return '$m分钟';
  return '$m分$s秒';
}

String nowTimeStr() {
  final now = DateTime.now();
  return '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
}

String genId() {
  return DateTime.now().millisecondsSinceEpoch.toRadixString(36) +
      (DateTime.now().microsecondsSinceEpoch % 100000).toRadixString(36);
}
