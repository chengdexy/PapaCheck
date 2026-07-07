import { Download, UserPlus, Smartphone, Tablet, Globe, WifiOff, ShieldCheck } from 'lucide-react';
import Mascot from '../Mascot';

export default function Hero() {
  return (
    <section className="hero-bg pt-12 pb-20 md:pt-20 md:pb-28">
      <div className="hero-container relative">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 lg:gap-12 items-center">
          <div className="relative z-10 max-w-2xl">
            <div className="hero-title-in hero-title-in-delay-1 inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full bg-white/80 border border-brand-200 text-brand-700 text-xs font-semibold tracking-wide">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
              </span>
              PapaCheck · 爸~检查！
            </div>

            <h1 className="hero-title-in hero-title-in-delay-2 text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight text-ink-900">
              写作业
              <br />
              <span className="hl-stroke">不用催</span>
              了
            </h1>

            <p className="hero-title-in hero-title-in-delay-3 mt-6 text-lg sm:text-xl text-ink-600 leading-relaxed max-w-xl">
              AI 评优 + 积分商城，孩子想要什么自己挣。
              <br className="hidden sm:block" />
              家长少操心，孩子多主动。
            </p>

            <div className="hero-title-in hero-title-in-delay-4 mt-10 flex flex-wrap items-center gap-3">
              <a href={`${import.meta.env.BASE_URL}api/download`} className="cta-primary">
                <Download className="w-5 h-5" />
                免费下载 Android
              </a>
              <a href="https://papacheck.chengdexy.cn/admin/?tab=register" className="cta-secondary">
                <UserPlus className="w-5 h-5" />
                注册家庭账号
              </a>
            </div>

            <div className="hero-title-in hero-title-in-delay-5 mt-8 flex flex-wrap items-center gap-2">
              <div className="trust-chip">
                <Smartphone className="w-3.5 h-3.5 text-brand-500" />
                Android
              </div>
              <div className="trust-chip">
                <Tablet className="w-3.5 h-3.5 text-brand-500" />
                iPad
              </div>
              <div className="trust-chip">
                <Globe className="w-3.5 h-3.5 text-brand-500" />
                Web
              </div>
              <div className="trust-chip">
                <WifiOff className="w-3.5 h-3.5 text-emerald-500" />
                完全离线可用
              </div>
              <div className="trust-chip">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                不强制注册
              </div>
            </div>
          </div>

          <div className="relative z-10 order-first lg:order-last flex items-center justify-center">
            <div className="relative w-full max-w-[480px] aspect-square">
              <div className="mascot-halo" />
              <Mascot
                name="wave"
                alt="PapaCheck 吉祥物"
                size={480}
                priority
                className="mascot-float relative z-10 w-full h-full object-contain drop-shadow-[0_20px_30px_rgba(249,115,22,0.25)]"
              />
              <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-gradient-to-br from-yellow-300 to-orange-400 opacity-40 blur-xl" />
              <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-gradient-to-br from-orange-300 to-pink-300 opacity-30 blur-2xl" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
