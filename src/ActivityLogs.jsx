import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { isAdminRole } from './utils/roles';
import LiveUsersPanel from './components/LiveUsersPanel';

const ActivityLogs = ({ currentUser }) => {
  const [rawLogs, setRawLogs] = useState([]);
  const [rawOrders, setRawOrders] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [onlineSessions, setOnlineSessions] = useState([]);

  // Filter states
  const [subsystemFilter, setSubsystemFilter] = useState('All');
  const [userFilter, setUserFilter] = useState('All');
  const [actionFilter, setActionFilter] = useState('All');
  const [dateRange, setDateRange] = useState('All');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Fetch Activity Logs
  useEffect(() => {
    if (!isAdminRole(currentUser?.role)) return;
    const q = query(collection(db, 'activity_logs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() ?? null
      }));
      setRawLogs(data);
      setLoadingLogs(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Fetch Orders and convert them into 'virtual' logs
  useEffect(() => {
    if (!isAdminRole(currentUser?.role)) return;
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const order = doc.data();
        return {
          id: doc.id,
          uid: order.cashierName || 'Guest', // Match by name in filters
          name: order.cashierName || 'Guest',
          role: 'cashier',
          subsystem: 'POS',
          action: 'PROCESS_SALE',
          meta: {
            amount: order.totalAmount,
            payment: order.paymentMethod,
            items: order.items?.length || 0,
            transaction: order.transactionNumber || ''
          },
          createdAt: order.createdAt?.toDate?.() ?? null
        };
      });
      setRawOrders(data);
      setLoadingOrders(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Compute filtered logs and available filters locally
  const { filteredLogs, availableSubsystems, availableActions, availableUsers, salesPerformance } = React.useMemo(() => {
    let combined = [...rawLogs, ...rawOrders];

    // 1. Sort by date
    combined.sort((a, b) => {
      const tA = a.createdAt ? a.createdAt.getTime() : 0;
      const tB = b.createdAt ? b.createdAt.getTime() : 0;
      return tB - tA;
    });

    // 2. Extract filter options BEFORE filtering
    const subsystems = [...new Set(combined.map(l => l.subsystem).filter(Boolean))];
    const actions = [...new Set(combined.map(l => l.action).filter(Boolean))];
    
    const usersMap = new Map();
    combined.forEach(log => {
      if (log.uid || log.name) {
        const uId = log.uid || log.name;
        const nameKey = String(uId).toLowerCase();
        if (!usersMap.has(nameKey)) {
          usersMap.set(nameKey, { uid: uId, name: log.name || log.fullname || log.username || log.email || uId, role: log.role });
        }
      }
    });
    const users = Array.from(usersMap.values());

    // 3. Apply Filters
    if (subsystemFilter !== 'All') {
      combined = combined.filter(l => l.subsystem === subsystemFilter);
    }
    if (userFilter !== 'All') {
      const lowerFilter = userFilter.toLowerCase();
      combined = combined.filter(l => {
        const names = [l.uid, l.name, l.fullname, l.username, l.email].filter(Boolean).map(n => String(n).toLowerCase());
        return names.includes(lowerFilter);
      });
    }
    if (actionFilter !== 'All') {
      combined = combined.filter(l => l.action === actionFilter);
    }
    if (dateRange !== 'All') {
      const now = new Date();
      let startDate = null;
      let endDate = new Date();

      switch (dateRange) {
        case 'Today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'Last 7 Days':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'Last 30 Days':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'Custom':
          if (customStart) startDate = new Date(customStart);
          if (customEnd) endDate = new Date(customEnd);
          break;
        default:
          break;
      }

      if (startDate) {
        combined = combined.filter(log => log.createdAt && log.createdAt >= startDate);
      }
      if (endDate) {
        combined = combined.filter(log => log.createdAt && log.createdAt <= endDate);
      }
    }

    // 4. Compute Sales Performance locally (only if a user is selected)
    let performance = null;
    if (userFilter !== 'All') {
      const selectedUser = users.find(u => u.uid === userFilter);
      if (selectedUser) { // Always compute it for any selected user. It will just be 0 if they have no sales.
        const salesLogs = combined.filter(log => log.action === 'PROCESS_SALE' && log.subsystem === 'POS');
        let totalRevenue = 0;
        salesLogs.forEach(log => {
          totalRevenue += (Number(log.meta.amount) || 0);
        });
        performance = {
          totalRevenue,
          totalOrders: salesLogs.length,
          avgOrderValue: salesLogs.length > 0 ? totalRevenue / salesLogs.length : 0
        };
      }
    }

    return { 
      filteredLogs: combined, 
      availableSubsystems: subsystems, 
      availableActions: actions, 
      availableUsers: users,
      salesPerformance: performance 
    };
  }, [rawLogs, rawOrders, subsystemFilter, userFilter, actionFilter, dateRange, customStart, customEnd]);

  useEffect(() => {
    if (!isAdminRole(currentUser?.role)) {
      setOnlineSessions([]);
      return undefined;
    }

    const q = query(collection(db, 'user_sessions'), where('status', '==', 'online'));
    const unsub = onSnapshot(q, (snapshot) => {
      const sessions = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          lastSeenAt: data.lastSeenAt?.toDate?.() ?? null
        };
      });

      sessions.sort((a, b) => {
        const aMs = a.lastSeenAt ? a.lastSeenAt.getTime() : 0;
        const bMs = b.lastSeenAt ? b.lastSeenAt.getTime() : 0;
        return bMs - aMs;
      });
      setOnlineSessions(sessions);
    });

    return () => unsub();
  }, [currentUser]);

  if (!isAdminRole(currentUser?.role)) {
    return <div className="text-center py-20 text-zinc-400">Access denied. Admin role required.</div>;
  }

  if (loadingLogs || loadingOrders) {
    return (
      <div className="flex justify-center items-center py-20 text-zinc-400">
        <div className="animate-spin text-3xl mb-2 mr-3 inline-block">⏳</div>
        <p>Loading activity logs...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LiveUsersPanel currentUser={currentUser} sessions={onlineSessions} />

      {/* Filters */}
      <div className="content-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-sm text-zinc-900">User Activity</h3>
            <p className="text-[10px] text-zinc-500 mt-1">Monitoring which staff members are active and their specific sales performance</p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{filteredLogs.length} activities</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Subsystem Filter */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Subsystem</label>
            <select
              value={subsystemFilter}
              onChange={(e) => setSubsystemFilter(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              <option value="All">All Subsystems</option>
              {availableSubsystems.map(subsystem => (
                <option key={subsystem} value={subsystem}>{subsystem}</option>
              ))}
            </select>
          </div>

          {/* User Filter */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">User</label>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              <option value="All">All Users</option>
              {availableUsers.map(user => (
                <option key={user.uid} value={user.uid}>{user.name}</option>
              ))}
            </select>
          </div>

          {/* Action Filter */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              <option value="All">All Actions</option>
              {availableActions.map(action => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              <option value="All">All Time</option>
              <option value="Today">Today</option>
              <option value="Last 7 Days">Last 7 Days</option>
              <option value="Last 30 Days">Last 30 Days</option>
              <option value="Custom">Custom Range</option>
            </select>
          </div>
        </div>

        {/* Custom Date Inputs */}
        {dateRange === 'Custom' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Start Date</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">End Date</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
              />
            </div>
          </div>
        )}

        {/* Sales Performance Panel */}
        {userFilter !== 'All' && availableUsers.find(u => u.uid === userFilter)?.role?.toLowerCase() === 'cashier' && (
          <div className="mt-6 pt-6 border-t border-zinc-100">
            <h4 className="font-bold text-sm text-zinc-900 mb-4">Sales Performance</h4>
            {salesPerformance ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Total Sales</p>
                  <p className="text-2xl font-black text-emerald-900">₱{salesPerformance.totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
                <div className="bg-sky-50 border border-sky-100 p-4 rounded-xl">
                  <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wider mb-1">Transactions</p>
                  <p className="text-2xl font-black text-sky-900">{salesPerformance.totalOrders}</p>
                </div>
                <div className="bg-violet-50 border border-violet-100 p-4 rounded-xl">
                  <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-1">Avg. Order Value</p>
                  <p className="text-2xl font-black text-violet-900">₱{salesPerformance.avgOrderValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No sales data available for this user.</p>
            )}
          </div>
        )}
      </div>

      {/* Logs Table */}
      <div className="content-card">
        <div className="table-container">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell">Timestamp</th>
                <th className="table-head-cell">User</th>
                <th className="table-head-cell">Subsystem</th>
                <th className="table-head-cell">Action</th>
                <th className="table-head-cell">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="table-row">
                  <td className="table-data-cell text-zinc-500">
                    {log.createdAt ? log.createdAt.toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    }) : '—'}
                  </td>
                  <td className="table-data-cell">
                    <div className="flex flex-col">
                      <span className="font-bold text-zinc-800">{log.name || log.fullname || log.username || 'Unknown User'}</span>
                      {log.email && <span className="text-[10px] text-zinc-400">{log.email}</span>}
                    </div>
                  </td>
                  <td className="table-data-cell text-zinc-600">{log.subsystem || '—'}</td>
                  <td className="table-data-cell">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border text-blue-700 bg-blue-50 border-blue-200">
                      {log.action}
                    </span>
                  </td>
                  <td className="table-data-cell text-zinc-600">
                    {log.meta && Object.keys(log.meta).length > 0 ?
                      <div className="text-[10px] space-y-1">
                        {Object.entries(log.meta).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium">{key}:</span> {String(value)}
                          </div>
                        ))}
                      </div>
                      : '—'
                    }
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-10 text-center text-zinc-400">
                    No activity logs found matching the current filters.
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

export default ActivityLogs;