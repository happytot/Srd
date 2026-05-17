import React, { useState, useEffect, useMemo } from 'react';
import { db } from './firebase';
import { Loader2 } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { isAdminRole } from './utils/roles';
import LiveUsersPanel from './components/LiveUsersPanel';

const ActivityLogs = ({ currentUser }) => {
  const [rawLogs, setRawLogs] = useState([]);
  const [rawOrders, setRawOrders] = useState([]);
  const [rawInventoryLogs, setRawInventoryLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingInventory, setLoadingInventory] = useState(true);

  // Filters
  const [subsystemFilter, setSubsystemFilter] = useState('All');
  const [userFilter, setUserFilter] = useState('All');
  const [actionFilter, setActionFilter] = useState('All');
  const [dateRange, setDateRange] = useState('All');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // NEW: Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 30;

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

  // Fetch Orders and convert to virtual activity logs
  useEffect(() => {
    if (!isAdminRole(currentUser?.role)) return;

    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const order = doc.data();
        const baristaName = order.baristaName || order.cashierName || 'Guest';

        return {
          id: doc.id,
          uid: baristaName,
          name: baristaName,                    // ← Fixed
          role: 'barista',                      // ← Changed to barista
          subsystem: 'POS',
          action: 'PROCESS_SALE',
          meta: {
            amount: order.totalAmount,
            payment: order.paymentMethod,
            items: order.items?.length || 0,
            transaction: order.transactionNumber || order.transactionId || ''
          },
          createdAt: order.createdAt?.toDate?.() ?? null
        };
      });
      setRawOrders(data);
      setLoadingOrders(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Fetch Inventory Logs
  useEffect(() => {
    if (!isAdminRole(currentUser?.role)) return;

    const q = query(collection(db, 'inventoryLogs'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const log = doc.data();

        // Clean up meta object to only include fields that exist
        const meta = {};
        if (log.itemName || log.item) meta.item = log.itemName || log.item;
        if (log.quantity || log.qty) meta.quantity = log.quantity || log.qty;
        if (log.details || log.description) meta.details = log.details || log.description;
        if (log.status) meta.status = log.status;

        return {
          id: doc.id,
          uid: log.uid || log.userEmail || log.userId || 'System',
          name: log.name || log.userName || log.userEmail || 'Inventory User',
          role: log.role || 'staff',
          subsystem: 'Inventory',
          action: log.action || 'INVENTORY_UPDATE',
          meta: Object.keys(meta).length > 0 ? meta : { info: 'Inventory Action' },
          createdAt: log.createdAt?.toDate?.() || log.timestamp?.toDate?.() || new Date()
        };
      });
      setRawInventoryLogs(data);
      setLoadingInventory(false);
    }, (error) => {
      console.error("Error fetching inventory logs:", error);
      setLoadingInventory(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Combined & Filtered Logs + Performance
  const { filteredLogs, availableSubsystems, availableActions, availableUsers, salesPerformance } = useMemo(() => {
    let combined = [...rawLogs, ...rawOrders, ...rawInventoryLogs];

    // Sort by newest first
    combined.sort((a, b) => {
      const tA = a.createdAt ? a.createdAt.getTime() : 0;
      const tB = b.createdAt ? b.createdAt.getTime() : 0;
      return tB - tA;
    });

    // Extract filter options
    const subsystems = [...new Set(combined.map(l => l.subsystem).filter(Boolean))];
    const actions = [...new Set(combined.map(l => l.action).filter(Boolean))];

    const usersMap = new Map();
    combined.forEach(log => {
      const uId = log.uid || log.name;
      if (uId) {
        const key = String(uId).toLowerCase();
        if (!usersMap.has(key)) {
          usersMap.set(key, {
            uid: uId,
            name: log.name || log.fullname || log.username || log.email || uId,
            role: log.role
          });
        }
      }
    });
    const users = Array.from(usersMap.values());

    // Apply Filters
    let filtered = combined;

    if (subsystemFilter !== 'All') {
      filtered = filtered.filter(l => l.subsystem === subsystemFilter);
    }
    if (userFilter !== 'All') {
      const lowerFilter = userFilter.toLowerCase();
      filtered = filtered.filter(l => {
        const names = [l.uid, l.name, l.fullname, l.username, l.email].filter(Boolean).map(n => String(n).toLowerCase());
        return names.includes(lowerFilter);
      });
    }
    if (actionFilter !== 'All') {
      filtered = filtered.filter(l => l.action === actionFilter);
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

      if (startDate) filtered = filtered.filter(log => log.createdAt && log.createdAt >= startDate);
      if (endDate) filtered = filtered.filter(log => log.createdAt && log.createdAt <= endDate);
    }

    // Sales Performance for selected user
    let performance = null;
    if (userFilter !== 'All') {
      const salesLogs = filtered.filter(log => log.action === 'PROCESS_SALE' && log.subsystem === 'POS');
      let totalRevenue = 0;
      salesLogs.forEach(log => {
        totalRevenue += (Number(log.meta?.amount) || 0);
      });
      performance = {
        totalRevenue,
        totalOrders: salesLogs.length,
        avgOrderValue: salesLogs.length > 0 ? totalRevenue / salesLogs.length : 0
      };
    }

    return {
      filteredLogs: filtered,
      availableSubsystems: subsystems,
      availableActions: actions,
      availableUsers: users,
      salesPerformance: performance
    };
  }, [rawLogs, rawOrders, rawInventoryLogs, subsystemFilter, userFilter, actionFilter, dateRange, customStart, customEnd]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [subsystemFilter, userFilter, actionFilter, dateRange, customStart, customEnd]);

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
  const startIndex = (currentPage - 1) * logsPerPage;
  const paginatedLogs = filteredLogs.slice(startIndex, startIndex + logsPerPage);


  if (!isAdminRole(currentUser?.role)) {
    return <div className="text-center py-20 text-zinc-400">Access denied. Admin role required.</div>;
  }

  if (loadingLogs || loadingOrders || loadingInventory) {
    return (
      <div className="flex justify-center items-center py-20 text-zinc-400">
        <Loader2 className="animate-spin mb-2 mr-3 inline-block" size={32} />
        <p>Loading activity logs...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LiveUsersPanel currentUser={currentUser} />

      {/* Filters */}
      <div className="content-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-sm text-zinc-900">User Activity</h3>
            <p className="text-[10px] text-zinc-500 mt-1">Monitoring staff activity and sales performance</p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{filteredLogs.length} activities</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Subsystem</label>
            <select
              value={subsystemFilter}
              onChange={(e) => setSubsystemFilter(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              <option value="All">All Subsystems</option>
              {availableSubsystems.map(sub => <option key={sub} value={sub}>{sub}</option>)}
            </select>
          </div>

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

          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500"
            >
              <option value="All">All Actions</option>
              {availableActions.map(action => <option key={action} value={action}>{action}</option>)}
            </select>
          </div>

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

        {/* Sales Performance for selected user */}
        {userFilter !== 'All' && salesPerformance && (
          <div className="mt-6 pt-6 border-t border-zinc-100">
            <h4 className="font-bold text-sm text-zinc-900 mb-4">Sales Performance</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Total Sales</p>
                <p className="text-2xl font-black text-emerald-900">₱{salesPerformance.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="bg-sky-50 border border-sky-100 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wider mb-1">Transactions</p>
                <p className="text-2xl font-black text-sky-900">{salesPerformance.totalOrders}</p>
              </div>
              <div className="bg-violet-50 border border-violet-100 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-1">Avg. Order Value</p>
                <p className="text-2xl font-black text-violet-900">₱{salesPerformance.avgOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Activity Logs Table with Pagination */}
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
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="table-row">
                  <td className="table-data-cell text-zinc-500">
                    {log.createdAt ? log.createdAt.toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    }) : '—'}
                  </td>
                  <td className="table-data-cell">
                    <div className="flex flex-col">
                      <span className="font-bold text-zinc-800">{log.name || 'Unknown User'}</span>
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
                    {log.meta && Object.keys(log.meta).length > 0 ? (
                      <div className="text-[10px] space-y-1">
                        {Object.entries(log.meta).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium">{key}:</span> {String(value)}
                          </div>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}

              {paginatedLogs.length === 0 && (
                <tr>
                  <td colSpan="5" className="py-10 text-center text-zinc-400">
                    No activity logs found matching the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between mt-4 px-2 text-xs text-zinc-500">
          <span>
            Showing {filteredLogs.length > 0 ? startIndex + 1 : 0} to {Math.min(startIndex + logsPerPage, filteredLogs.length)} of {filteredLogs.length} logs
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-3 py-1 bg-black text-white rounded">
              Page {currentPage} of {totalPages || 1}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityLogs;