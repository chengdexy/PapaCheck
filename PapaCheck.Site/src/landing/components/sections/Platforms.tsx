import { Tablet, Smartphone, Globe, Cloud, Check } from 'lucide-react';

const platforms = [
  {
    icon: Tablet,
    name: '孩子大屏',
    device: 'Android / iPad',
    desc: '放在桌前，孩子自己查看作业和积分进度。大屏显示更专注。',
    mainColor: 'bg-brand-500',
  },
  {
    icon: Smartphone,
    name: '家长手机',
    device: 'Android',
    desc: '在手机上收到完成通知，一键评优。随时随地管理孩子的任务。',
    mainColor: 'bg-sky-500',
  },
  {
    icon: Globe,
    name: '浏览器',
    device: '任何设备',
    desc: '无需安装，打开网页就能用。出差/旅游时也不耽误。',
    mainColor: 'bg-emerald-500',
  },
];

export default function Platforms() {
  return (
    <section id="platforms" className="py-20 md:py-28 bg-white">
      <div className="hero-container">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide">
            多端协同
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold text-ink-900 tracking-tight">
            <span className="hl-stroke">三端同步</span>，随时查看
          </h2>
          <p className="mt-4 text-lg text-ink-600 max-w-2xl mx-auto">
            一次录入，三端实时同步。孩子的进度，爸妈随时看到。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {platforms.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={i}
                className="group relative overflow-hidden rounded-2xl border border-ink-200/60 bg-gradient-to-br from-white to-cream-50 p-7 hover:shadow-lg transition-all duration-300"
              >
                {/* 设备图标 */}
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl ${p.mainColor} text-white mb-5 shadow-md`}>
                  <Icon className="w-7 h-7" strokeWidth={2} />
                </div>

                <h3 className="text-xl font-bold text-ink-900 mb-1">
                  {p.name}
                </h3>
                <div className="text-xs font-semibold text-ink-500 mb-4">
                  {p.device}
                </div>

                <p className="text-sm text-ink-600 leading-relaxed">
                  {p.desc}
                </p>

                {/* 装饰条 */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-brand-200 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            );
          })}
        </div>

        {/* 底部 trust strip */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-ink-600">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            云端实时同步
          </div>
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-sky-500" />
            登录自动同步
          </div>
        </div>
      </div>
    </section>
  );
}
