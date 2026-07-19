import { Sparkles } from 'lucide-react';
import { cn } from '../../../lib/cn';

export default function TopNav() {
  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md bg-white/70 border-b border-ink-200/60">
      <div className="hero-container flex items-center justify-between h-16">
        <a href={import.meta.env.BASE_URL} className="flex items-center gap-2.5 group">
          <img
            src={`${import.meta.env.BASE_URL}imgs/favicon.png`}
            alt="PapaCheck"
            className="w-9 h-9 rounded-xl transition-transform group-hover:rotate-6"
          />
          <div className="flex flex-col leading-none">
            <span className="font-extrabold text-ink-900 text-lg tracking-tight">
              PapaCheck
            </span>
            <span className="text-[10px] text-ink-500 font-medium tracking-wider">
              爸~检查！
            </span>
          </div>
        </a>

        <div className="hidden md:flex items-center gap-1">
          {[
            { label: '功能', href: '#features' },
            { label: '场景', href: '#scenes' },
            { label: '平台', href: '#platforms' },
            { label: '下载', href: '#download' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                'px-3.5 py-1.5 text-sm font-medium text-ink-600 rounded-full',
                'hover:text-brand-600 hover:bg-brand-50 transition-colors',
              )}
            >
              {item.label}
            </a>
          ))}
        </div>

        <a
          href={`${import.meta.env.BASE_URL}admin/`}
          className={cn(
            'hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5',
            'text-sm font-semibold text-ink-700 rounded-full',
            'border border-ink-200 hover:border-brand-300',
            'hover:text-brand-600 transition-colors',
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          登录管理
        </a>
      </div>
    </nav>
  );
}
