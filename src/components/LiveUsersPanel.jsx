import { isAdminRole } from '../utils/roles';

const LiveUsersPanel = ({ currentUser, sessions }) => {
  if (!isAdminRole(currentUser?.role)) return null;

  return (
    <div className="content-card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm text-zinc-900">Live users (remote monitoring)</h3>
          <p className="text-[10px] text-zinc-500 mt-1">Shows currently online users across shared Firestore sessions.</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{sessions.length} online</span>
      </div>

      <div className="table-container mt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell">User</th>
                <th className="table-head-cell">Role</th>
                <th className="table-head-cell">Subsystem</th>
                <th className="table-head-cell">Last Seen</th>
                <th className="table-head-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sessions.map((s) => (
                <tr key={s.id} className="table-row">
                  <td className="table-data-cell">
                    <p className="font-bold text-zinc-800">{s.name || s.fullname || s.username || s.email || 'Unknown User'}</p>
                    {s.email ? <p className="text-[10px] text-zinc-400">{s.email}</p> : null}
                  </td>
                  <td className="table-data-cell text-zinc-600">{s.role || '—'}</td>
                  <td className="table-data-cell text-zinc-600">{s.subsystem || 'Unknown'}</td>
                  <td className="table-data-cell text-zinc-500">
                    {s.lastSeenAt ? s.lastSeenAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="table-data-cell">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border text-emerald-700 bg-emerald-50 border-emerald-200">
                      ONLINE
                    </span>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-10 text-center text-zinc-400">
                    No online users detected right now.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LiveUsersPanel;
