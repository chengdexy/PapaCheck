import { Heart, Zap, RefreshCw } from 'lucide-react';

const features = [
  {
    icon: Heart,
    title: '孩子主动想写',
    subtitle: '培养自驱力',
    body: '积分商城 + 任务清单 + AI 评优，孩子为了想要的东西自己努力。爸妈不催不喊，关系更轻松。',
    color: 'from-pink-100 to-rose-50',
    iconBg: 'bg-pink-100',
    iconColor: 'text-pink-600',
  },
  {
    icon: Zap,
    title: '爸妈 1 分钟搞定',
    subtitle: '操作简单',
    body: '添加作业、一键评优、实时同步进度。不用守在桌前，手机就能完成所有管理。',
    color: 'from-amber-100 to-yellow-50',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    icon: RefreshCw,
    title: 'Android · iPad · Web',
    subtitle: '三端无缝',
    body: '云端实时同步，登录后自动更新。孩子的进度在哪里都能看到。',
    color: 'from-sky-100 to-blue-50',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-600',
  },
];

export default function Features() {
  return (
    <section id="features" className="py-20 md:py-28 bg-cream-50">
      <div className="hero-container">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide">
            核心能力
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold text-ink-900 tracking-tight">
            三件事，<span className="hl-stroke">一次搞定</span>
          </h2>
          <p className="mt-4 text-lg text-ink-600 max-w-2xl mx-auto">
            自驱力 + 家长省心 + 多端同步
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="group relative bg-white rounded-2xl p-7 border border-ink-200/60 hover:border-brand-300 hover:shadow-lg transition-all duration-300"
              >
                {/* 顶部装饰条 */}
                <div className={`absolute top-0 left-7 right-7 h-1 rounded-b-full bg-gradient-to-r ${f.color}`} />

                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${f.iconBg} mb-5`}>
                  <Icon className={`w-6 h-6 ${f.iconColor}`} strokeWidth={2} />
                </div>

                <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">
                  {f.subtitle}
                </div>
                <h3 className="text-xl font-bold text-ink-900 mb-3">
                  {f.title}
                </h3>
                <p className="text-sm text-ink-600 leading-relaxed">
                  {f.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
