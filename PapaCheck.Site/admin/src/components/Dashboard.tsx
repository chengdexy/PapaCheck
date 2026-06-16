import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import MemberTable from './MemberTable';
import AddMemberForm from './AddMemberForm';

export default function Dashboard() {
  const { logout } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="max-w-[640px] mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-semibold text-zinc-900">家庭管理</h2>
        <button onClick={logout} className="text-sm text-zinc-500 hover:text-zinc-700 transition-colors">退出</button>
      </div>
      <section className="mb-10">
        <h3 className="text-sm font-medium text-zinc-500 mb-4">家庭成员</h3>
        <MemberTable refreshKey={refreshKey} />
      </section>
      <section>
        <h3 className="text-sm font-medium text-zinc-500 mb-4">添加成员</h3>
        <AddMemberForm onAdded={() => setRefreshKey(k => k + 1)} />
      </section>
    </div>
  );
}
