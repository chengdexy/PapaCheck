import { ExternalLink } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-ink-200/60 bg-white py-10">
      <div className="hero-container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/imgs/favicon.png" alt="PapaCheck" className="w-8 h-8 rounded-lg" />
            <div>
              <div className="font-bold text-ink-900">PapaCheck</div>
              <div className="text-xs text-ink-500">爸~检查！让孩子主动写作业</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-600">
            <a href="/admin/" className="hover:text-brand-600 transition-colors">
              管理面板
            </a>
            <a
              href="https://github.com/chengdexy/PapaCheck"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-brand-600 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              GitHub
            </a>
            <span className="text-ink-400">·</span>
            <span className="text-ink-500">v3.0 · 100% 免费 · 离线可用</span>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-ink-100 text-center text-xs text-ink-400">
          ©  PapaCheck  ·  Made with care for families
        </div>
      </div>
    </footer>
  );
}
