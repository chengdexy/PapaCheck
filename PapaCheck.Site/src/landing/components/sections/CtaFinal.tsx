import { Download, UserPlus, Heart, Check } from 'lucide-react';
import Mascot from '../Mascot';

export default function CtaFinal() {
  return (
    <section id="download" className="py-20 md:py-28 hero-bg">
      <div className="hero-container">
        <div className="relative max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-10 items-center bg-white rounded-3xl p-8 md:p-12 shadow-2xl border border-ink-200/60">
            {/* 左侧：CTA 内容 */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide">
                <Heart className="w-3.5 h-3.5" />
                今晚就试试
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-ink-900 leading-tight tracking-tight">
                下载 PapaCheck
                <br />
                <span className="hl-stroke">10 分钟</span>完成首次设置
              </h2>
              <p className="mt-4 text-ink-600 leading-relaxed">
                孩子大屏 + 家长手机 + 浏览器，一次下载全搞定。
                已有家庭账号？直接登录即可。
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a href={`${import.meta.env.BASE_URL}api/download`} className="cta-primary">
                  <Download className="w-5 h-5" />
                  免费下载 Android
                </a>
                <a href={`${import.meta.env.BASE_URL}admin/?tab=register`} className="cta-secondary">
                  <UserPlus className="w-5 h-5" />
                  注册家庭账号
                </a>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-500">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  100% 免费
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  无广告
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  不强制注册
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  云端实时同步
                </div>
              </div>
            </div>

            {/* 右侧：吉祥物挥手告别 */}
            <div className="relative flex items-center justify-center">
              <div className="relative w-full max-w-[320px] aspect-square">
                <div className="mascot-halo" />
                <Mascot
                  name="bye"
                  alt="PapaCheck 吉祥物挥手告别"
                  size={320}
                  className="mascot-float relative z-10 w-full h-full object-contain drop-shadow-[0_20px_30px_rgba(249,115,22,0.25)]"
                />
                <div className="absolute top-4 -right-2 w-12 h-12 rounded-full bg-pink-200/50 blur-lg" />
                <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-rose-200/40 blur-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
