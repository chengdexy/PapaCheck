import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import MemberTable from './MemberTable';
import AddMemberForm from './AddMemberForm';
import BrandHeader from './BrandHeader';

export default function Dashboard() {
  const { logout } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen px-4 py-6 md:py-10">
      <div className="max-w-3xl mx-auto animate-brand-fade-up">
        <BrandHeader
          title="家庭管理"
          subtitle="管理家庭成员、查看访问码"
          role="family"
          onLogout={logout}
        />

        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-700)] flex items-center gap-1.5">
              <span className="inline-block w-1 h-4 rounded-sm bg-gradient-to-b from-[var(--color-brand-400)] to-[var(--color-brand-600)]" />
              家庭成员
            </h3>
            <span className="text-xs text-[var(--color-ink-400)]">
              共 <span className="font-semibold text-[var(--color-ink-700)]">·</span> 位
            </span>
          </div>
          <MemberTable refreshKey={refreshKey} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--color-ink-700)] flex items-center gap-1.5">
              <span className="inline-block w-1 h-4 rounded-sm bg-gradient-to-b from-[var(--color-brand-400)] to-[var(--color-brand-600)]" />
              添加成员
            </h3>
          </div>
          <div className="pc-card p-5">
            <AddMemberForm onAdded={() => setRefreshKey(k => k + 1)} />
          </div>
        </section>

        <p className="text-center text-xs text-[var(--color-ink-400)] mt-10">
          © PapaCheck · 让家庭协作更轻松
        </p>
      </div>
    </div>
  );
}
