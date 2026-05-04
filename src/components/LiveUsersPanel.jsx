import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { isAdminRole } from '../utils/roles';

const LiveUsersPanel = ({ currentUser }) => {
  const [liveUsers, setLiveUsers] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAdminRole(currentUser?.role)) return;

    // Listen to ALL online sessions across every subsystem
    const q = query(
      collection(db, 'user_sessions'),
      where('status', '==', 'online')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allSessions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        lastSeenAt: doc.data().lastSeenAt?.toDate?.() ?? null
      }));

      // Deduplicate by user (uid or email)
      const uniqueUsers = {};

      allSessions.forEach(session => {
        const userKey = session.uid || session.email;

        if (!uniqueUsers[userKey]) {
          uniqueUsers[userKey] = {
            ...session,
            activeSubsystems: [session.subsystem || 'SRD']
          };
        } else {
          // User already exists → add subsystem to the list
          const currentSubsystems = uniqueUsers[userKey].activeSubsystems || [];
          if (!currentSubsystems.includes(session.subsystem)) {
            uniqueUsers[userKey].activeSubsystems = [...currentSubsystems, session.subsystem || 'SRD'];
          }
        }
      });

      // Convert to array and sort by most recently active
      const dedupedUsers = Object.values(uniqueUsers).sort((a, b) => {
        const timeA = a.lastSeenAt?.getTime?.() || 0;
        const timeB = b.lastSeenAt?.getTime?.() || 0;
        return timeB - timeA;
      });

      setLiveUsers(dedupedUsers);
    });

    return () => unsubscribe();
  }, [currentUser]);

  if (!isAdminRole(currentUser?.role)) return null;

  // Filter out ghost sessions (last seen > 3 minutes ago)
  const activeUsers = liveUsers.filter(user => {
    if (!user.lastSeenAt) return false;
    return (now - user.lastSeenAt.getTime()) <= 3 * 60 * 1000;
  });

  return (
    <div className="content-card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm text-zinc-900">Live Users (All Systems)</h3>
          <p className="text-[10px] text-zinc-500 mt-1">
            Showing unique users across SRD, POS, and Inventory
          </p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
          {activeUsers.length} online
        </span>
      </div>

      <div className="table-container mt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell">User</th>
                <th className="table-head-cell">Active In</th>
                <th className="table-head-cell">Last Seen</th>
                <th className="table-head-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {activeUsers.map((user) => (
                <tr key={user.id} className="table-row">
                  <td className="table-data-cell">
                    <p className="font-bold text-zinc-800">{user.name || user.email || 'Unknown User'}</p>
                    <p className="text-[9px] text-zinc-400">{user.email}</p>
                  </td>
                  <td className="table-data-cell">
                    <div className="flex flex-wrap gap-1">
                      {(user.activeSubsystems || []).map((sys, index) => (
                        <span
                          key={index}
                          className="px-2 py-0.5 text-[9px] font-bold rounded bg-zinc-100 text-zinc-600"
                        >
                          {sys}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="table-data-cell text-xs text-zinc-500">
                    {user.lastSeenAt
                      ? user.lastSeenAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                      : 'Just now'}
                  </td>
                  <td className="table-data-cell">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border text-emerald-700 bg-emerald-50 border-emerald-200">
                      ONLINE
                    </span>
                  </td>
                </tr>
              ))}

              {activeUsers.length === 0 && (
                <tr>
                  <td colSpan="4" className="py-10 text-center text-zinc-400">
                    No users currently online.
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