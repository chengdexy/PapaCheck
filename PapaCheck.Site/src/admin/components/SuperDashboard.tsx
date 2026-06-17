import { useAuth } from '../hooks/useAuth';
import TenantTable from './TenantTable';
import SystemHealth from './SystemHealth';
import BrandHeader from './BrandHeader';

export default function SuperDashboard() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen px-4 py-6 md:py-10">
      <div className="max-w-3xl mx-auto animate-brand-fade-up">
        <BrandHeader
          title="超级管理员"
          subtitle="管理所有家庭 · 监控系统状态"
          role="super"
          onLogout={logout}
        />

        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-700)] flex items-center gap-1.5">
              <span className="inline-block w-1 h-4 rounded-sm bg-gradient-to-b from-violet-500 to-fuchsia-500" />
              所有家庭
            </h3>
          </div>
          <TenantTable />
        </section>

        <SystemHealth />

        <p className="text-center text-xs text-[var(--color-ink-400)] mt-10">
          © PapaCheck · 让家庭协作更轻松
        </p>
      </div>
    </div>
  );
}
