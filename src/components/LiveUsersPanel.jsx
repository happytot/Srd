import React from 'react';
import { isAdminRole } from '../utils/roles';

const LiveUsersPanel = ({ currentUser, sessions }) => {
  // Only render for admins
  if (!isAdminRole(currentUser?.role)) return null;

  return (
    <div className="content-card mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm text-zinc-900">Live Users</h3>
          <p className="text-[10px] text-zinc-500 mt-1">
            Real-time remote monitoring — currently online across all sessions
          </p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
          {sessions.length} online
        </span>
      </div>

      {/* Table */}
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
              {sessions.map((session) => (
                <tr key={session.id} className="table-row">
                  <td className="table-data-cell">
                    <p className="font-bold text-zinc-800">
                      {session.name || session.fullname || session.username || session.email || 'Unknown User'}
                    </p>
                    {session.email && (
                      <p className="text-[10px] text-zinc-400">{session.email}</p>
                    )}
                  </td>
                  <td className="table-data-cell text-zinc-600">{session.role || '—'}</td>
                  <td className="table-data-cell text-zinc-600">{session.subsystem || 'Unknown'}</td>
                  <td className="table-data-cell text-zinc-500">
                    {session.lastSeenAt
                      ? session.lastSeenAt.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                      : '—'}
                  </td>
                  <td className="table-data-cell">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border text-emerald-700 bg-emerald-50 border-emerald-200">
                      ONLINE
                    </span>
                  </td>
                </tr>
              ))}

              {/* Empty state */}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan="5" className="py-10 text-center text-zinc-400">
                    No online users detected right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LiveUsersPanel;