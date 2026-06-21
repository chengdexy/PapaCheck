import { Key, Baby, ArrowLeft, LogOut, ExternalLink } from 'lucide-react';

/** 开发模式下后端地址，生产模式用同源 */
const APP_BASE = import.meta.env.DEV ? 'http://localhost:8080' : '';

interface BrandHeaderProps {
  title: string;
  subtitle?: string;
  /** 决定右侧导航按钮的种类 */
  role: 'family' | 'super';
  onLogout: () => void;
}

export default function BrandHeader({ title, subtitle, role, onLogout }: BrandHeaderProps) {
  return (
    <header className="mb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 左侧：Logo + 标题 */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-white shadow-md shadow-orange-100 overflow-hidden ring-1 ring-orange-100"
            aria-hidden="true"
          >
            <img src="/favicon.png" alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-[var(--color-ink-900)] tracking-tight">
                {title}
              </h1>
              {role === 'super' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white">
                  <Key size={10} />
                  SUPER
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-[var(--color-ink-500)] mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* 右侧：快捷链接 + 退出 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <a
            href={`${APP_BASE}/app`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors"
          >
            <ExternalLink size={12} />
            客户端
          </a>
          <a
            href="/"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--color-ink-600)] hover:bg-[var(--color-ink-100)] rounded-md transition-colors"
          >
            <ArrowLeft size={12} />
            首页
          </a>
          <button
            onClick={onLogout}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--color-ink-600)] hover:bg-[var(--color-ink-100)] rounded-md transition-colors"
          >
            <LogOut size={12} />
            退出
          </button>
        </div>
      </div>
    </header>
  );
}
