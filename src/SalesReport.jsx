import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import ExportEngine from './utils/ExportEngine';

const SalesReport = ({ globalDateRange, globalCustomStart, globalCustomEnd }) => {
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [reportFilter, setReportFilter] = useState('Daily');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const data = querySnapshot.docs.map(doc => {
          const order = doc.data();
          const categories = order.items ? order.items.map(item => item.category) : [];
          const uniqueCategories = [...new Set(categories.filter(Boolean))];

          return {
            id: doc.id,
            date: order.createdAt ? order.createdAt.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A',
            timestamp: order.createdAt ? order.createdAt.toDate() : new Date(0),
            product: order.items ? order.items.map(item => `${item.quantity || 1}x ${item.name}`).join(', ') : 'Unknown',
            category: uniqueCategories.length === 1 ? uniqueCategories[0] : (uniqueCategories.length > 1 ? 'Multiple' : 'Unknown'),
            categories: uniqueCategories,
            amount: order.totalAmount || 0,
            originalTotalAmount: order.totalAmount || 0,
            originalItems: order.items || [],
            status: 'Completed',
            customer: order.cashierName || 'Guest'
          };
        });
        setReportData(data);
      } catch (error) {
        console.error("Error fetching orders:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  const filteredData = reportData.map(item => {
    let matchedItem = { ...item, isMatch: true };

    if (categoryFilter !== 'All Categories') {
      const matchedInnerItems = item.originalItems.filter(i =>
        i.category && i.category.toLowerCase().includes(categoryFilter.toLowerCase())
      );

      if (matchedInnerItems.length > 0) {
        const totalItemsSum = item.originalItems.reduce((sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0);
        const matchedItemsSum = matchedInnerItems.reduce((sum, i) => sum + ((i.price || 0) * (i.quantity || 1)), 0);

        const proportionalAmount = totalItemsSum > 0
          ? (matchedItemsSum / totalItemsSum) * item.originalTotalAmount
          : 0;

        matchedItem.product = matchedInnerItems.map(i => `${i.quantity || 1}x ${i.name}`).join(', ');
        const uniqueCategories = [...new Set(matchedInnerItems.map(i => i.category).filter(Boolean))];
        matchedItem.category = uniqueCategories.length === 1 ? uniqueCategories[0] : (uniqueCategories.length > 1 ? 'Multiple' : 'Unknown');
        matchedItem.amount = proportionalAmount;
      } else {
        matchedItem.isMatch = false;
      }
    }

    return matchedItem;
  }).filter(item => {
    if (!item.isMatch) return false;

    let dateMatch = true;
    if (item.timestamp) {
      const now = new Date();
      const itemDate = item.timestamp;

      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const itemDay = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());

      const diffTime = today.getTime() - itemDay.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (reportFilter === 'Daily') {
        dateMatch = diffDays === 0;
      } else if (reportFilter === 'Weekly') {
        dateMatch = diffDays <= 7 && diffDays >= 0;
      } else if (reportFilter === 'Monthly') {
        dateMatch = diffDays <= 30 && diffDays >= 0;
      } else if (reportFilter === 'Quarterly') {
        dateMatch = diffDays <= 90 && diffDays >= 0;
      } else if (reportFilter === 'Annually') {
        dateMatch = diffDays <= 365 && diffDays >= 0;
      }
    }

    return dateMatch;
  });

  const totalRevenue = filteredData.reduce((sum, item) => sum + item.amount, 0);
  const averageTransaction = filteredData.length ? totalRevenue / filteredData.length : 0;

  const getStatusColor = (status) => {
    switch (status) {
      case 'Completed': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'Pending': return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'Refunded': return 'text-rose-600 bg-rose-50 border-rose-200';
      default: return 'text-zinc-600 bg-zinc-50 border-zinc-200';
    }
  };

  const getReportName = () => {
    let base = 'Sales Report';
    switch (reportFilter) {
      case 'Daily': base = 'Daily Sales Report'; break;
      case 'Weekly': base = 'Weekly Sales Report'; break;
      case 'Monthly': base = 'Monthly Sales Report'; break;
      case 'Quarterly': base = 'Quarterly Sales Report'; break;
      case 'Annually': base = 'Annual Sales Report'; break;
    }
    if (categoryFilter !== 'All Categories') {
      return `${base} for ${categoryFilter}`;
    }
    return base;
  };

  const getFileNamePrefix = () => {
    let base = 'Sales_Report';
    switch (reportFilter) {
      case 'Daily': base = 'Daily_Sales_Report'; break;
      case 'Weekly': base = 'Weekly_Sales_Report'; break;
      case 'Monthly': base = 'Monthly_Sales_Report'; break;
      case 'Quarterly': base = 'Quarterly_Sales_Report'; break;
      case 'Annually': base = 'Annual_Sales_Report'; break;
    }
    if (categoryFilter !== 'All Categories') {
      return `${base}_${categoryFilter.replace(/\s+/g, '_')}`;
    }
    return base;
  };

  const generateExportData = () => {
    return filteredData.map(row => ({
      'Transaction ID': row.id,
      'Date': row.date,
      'Cashier': row.customer,
      'Items': row.product,
      'Category': row.category,
      'Amount': Number(row.amount), // Preserve Number format
      'Status': row.status
    }));
  };

  const handleExportExcel = () => {
    const exportData = generateExportData();
    if (exportData.length === 0) return;
    ExportEngine.exportToExcel(exportData, getFileNamePrefix(), 'Coffee and Tea Connection', getReportName());
  };

  const handleExportPDF = () => {
    const exportData = generateExportData();
    if (exportData.length === 0) return;
    ExportEngine.exportToPDF(exportData, getFileNamePrefix(), 'Coffee and Tea Connection', getReportName());
  };

  return (
    <div id="sales-report-content" className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 bg-zinc-50 pb-8">

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={reportFilter}
            onChange={(e) => setReportFilter(e.target.value)}
            className="search-input !w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 hover:border-zinc-300 cursor-pointer"
          >
            <option value="Daily">Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
            <option value="Quarterly">Quarterly</option>
            <option value="Annually">Annually</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="search-input !w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 hover:border-zinc-300 cursor-pointer"
          >
            <option>All Categories</option>
            <option>Coffee</option>
            <option>Tea</option>
            <option>Food</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button onClick={handleExportExcel} className="flex-1 sm:flex-none px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 transition-all active:scale-[0.98]">
            <span className="mr-1.5">📊</span> Excel
          </button>
          <button onClick={handleExportPDF} className="flex-1 sm:flex-none px-3 py-2 bg-white border border-rose-200 rounded-lg text-xs font-bold text-rose-700 shadow-sm hover:bg-rose-50 transition-all active:scale-[0.98]">
            <span className="mr-1.5">📄</span> PDF
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="stat-card">
          <p className="stat-card-title">Filtered Revenue</p>
          <p className="stat-card-value">₱{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-title">Transaction Count</p>
          <p className="stat-card-value">{filteredData.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-title">Average Transaction</p>
          <p className="stat-card-value">₱{averageTransaction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Detailed Data Table */}
      <div className="table-container mt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell">Transaction ID</th>
                <th className="table-head-cell">Date</th>
                <th className="table-head-cell">Cashier</th>
                <th className="table-head-cell">Items</th>
                <th className="table-head-cell">Amount</th>
                <th className="table-head-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredData.map((row) => (
                <tr key={row.id} className="table-row">
                  <td className="table-data-cell font-mono text-zinc-500" title={row.id}>{row.id.substring(0, 8)}...</td>
                  <td className="table-data-cell text-zinc-600">{row.date}</td>
                  <td className="table-data-cell font-medium">{row.customer}</td>
                  <td className="table-data-cell">
                    <div className="max-w-[200px]">
                      <p className="font-bold truncate" title={row.product}>{row.product}</p>
                      <p className="text-[10px] text-zinc-400 uppercase tracking-wider truncate" title={row.category}>{row.category}</p>
                    </div>
                  </td>
                  <td className="table-data-cell font-bold">₱{Number(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="table-data-cell">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}

              {loading ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-zinc-400">
                    <div className="animate-spin text-3xl mb-2 inline-block">⏳</div>
                    <p>Loading transactions...</p>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-zinc-400">
                    <div className="text-3xl mb-2">📊</div>
                    <p>No transactions found for the selected filters.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pagination Placeholder */}
        <div className="px-6 py-4 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500 bg-zinc-50/50">
          <span>Showing 1 to {filteredData.length} of {filteredData.length} entries</span>
          <div className="flex gap-1">
            <button className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50" disabled>Previous</button>
            <button className="px-3 py-1 bg-black text-white rounded">1</button>
            <button className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50" disabled>Next</button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default SalesReport;
