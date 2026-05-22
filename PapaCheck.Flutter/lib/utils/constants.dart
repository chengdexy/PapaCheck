
class SubjectConfig {
  final String icon;
  final int color;
  const SubjectConfig({required this.icon, required this.color});
}

const subjects = <String, SubjectConfig>{
  '语文': SubjectConfig(icon: '📖', color: 0xFFF87171),
  '数学': SubjectConfig(icon: '🔢', color: 0xFF60A5FA),
  '英语': SubjectConfig(icon: '🔤', color: 0xFFFBBF24),
  '科学': SubjectConfig(icon: '🔬', color: 0xFF4ADE80),
  '其他': SubjectConfig(icon: '📚', color: 0xFFA78BFA),
};

enum AppPage { main, shop, settlement, rated }