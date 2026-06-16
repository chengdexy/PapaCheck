import { useAuth } from '../hooks/useAuth';
import TenantTable from './TenantTable';

export default function SuperDashboard() {
  const { logout } = useAuth();

  return (
    <div className="max-w-[640px] mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-semibold text-zinc-900">超级管理员</h2>
        <button onClick={logout} className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors">退出</button>
      </div>
      <section>
        <h3 className="text-sm font-medium text-zinc-500 mb-4">所有家庭</h3>
        <TenantTable />
      </section>
    </div>
  );
}
