import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, getDocs, orderBy, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import ExportEngine from './utils/ExportEngine';
import {
  summarizeCashFromOrderRows,
  computeCashOnHand,
  sumExpensesAmount
} from './utils/cashReconciliation';
import { isAdminRole } from './utils/roles';

const formatPeso = (n) =>
  `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isUtilityExpense = (expense) => {
  const t = String(expense?.expenseType ?? '').toLowerCase();
  const s = String(expense?.expenseSubType ?? '').toLowerCase();
  return t === 'utility' || t === 'utilities' || ['electricity', 'water', 'internet', 'utilities'].includes(s);
};

const SalesReport = ({ globalDateRange, globalCustomStart, globalCustomEnd, currentUser }) => {
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [paymentFilter, setPaymentFilter] = useState('All Payments');
  const [reportData, setReportData] = useState([]);
  const [expenseRecords, setExpenseRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expensesLoadError, setExpensesLoadError] = useState(null);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [expenseType, setExpenseType] = useState('Operational');
  const [expenseSubType, setExpenseSubType] = useState('');
  const [utilityTargetPct, setUtilityTargetPct] = useState(8);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseFormError, setExpenseFormError] = useState('');
  const [pendingAddExpense, setPendingAddExpense] = useState(null);
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState('');

  const isAdmin = isAdminRole(currentUser?.role);

  const dateRangeBounds = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let startCurrent = new Date(today);
    let endCurrent = new Date(today);
    endCurrent.setHours(23, 59, 59, 999);

    if (globalDateRange === 'Today') {
      startCurrent.setHours(0,0,0,0);
    } else if (globalDateRange === 'Last 7 Days' || globalDateRange === 'Weekly') {
      startCurrent.setDate(startCurrent.getDate() - 6);
      startCurrent.setHours(0,0,0,0);
    } else if (globalDateRange === 'Month to Date' || globalDateRange === 'Monthly') {
      startCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
      startCurrent.setHours(0,0,0,0);
    } else if (globalDateRange === 'Last Quarter' || globalDateRange === 'Quarterly') {
      startCurrent.setDate(startCurrent.getDate() - 89);
      startCurrent.setHours(0,0,0,0);
    } else if (globalDateRange === 'Annually') {
      startCurrent = new Date(now.getFullYear(), 0, 1);
      startCurrent.setHours(0,0,0,0);
    } else if (globalDateRange === 'Custom') {
      if (globalCustomStart && globalCustomEnd) {
        startCurrent = new Date(globalCustomStart);
        startCurrent.setHours(0,0,0,0);
        endCurrent = new Date(globalCustomEnd);
        endCurrent.setHours(23, 59, 59, 999);
      }
    } else {
      startCurrent.setDate(startCurrent.getDate() - 29);
      startCurrent.setHours(0,0,0,0);
    }
    return { startCurrent, endCurrent };
  }, [globalDateRange, globalCustomStart, globalCustomEnd]);

  const loadExpenses = useCallback(async () => {
    setExpensesLoadError(null);
    try {
      const expQuery = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(expQuery);
      const rows = snap.docs.map((d) => {
        const x = d.data();
        const ts = x.createdAt?.toDate?.() ?? null;
        return {
          id: d.id,
          amount: Number(x.amount) || 0,
          description: x.description || x.note || '',
          expenseType: x.expenseType || 'Operational',
          expenseSubType: x.expenseSubType || '',
          timestamp: ts,
          createdByName: x.createdByName || '',
          createdByEmail: x.createdByEmail || '',
          createdByUid: x.createdByUid || ''
        };
      });
      setExpenseRecords(rows);
    } catch (err) {
      console.error('Error fetching expenses:', err);
      setExpenseRecords([]);
      setExpensesLoadError(
        'Could not load expenses. Add a Firestore collection `expenses` with fields `amount` (number) and `createdAt` (timestamp), and allow read access for dashboard users.'
      );
    }
  }, []);

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
            amount: Number(order.totalAmount) || 0,
            originalTotalAmount: Number(order.totalAmount) || 0,
            originalItems: order.items || [],
            status: 'Completed',
            customer: order.cashierName || 'Guest',
            paymentMethod: order.paymentMethod || 'Cash',
            gcashRefNumber: order.gcashRefNumber || ''
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
    loadExpenses();
  }, [loadExpenses]);

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
        // Maintain payment method fields in proportional splits
        matchedItem.paymentMethod = item.paymentMethod;
        matchedItem.gcashRefNumber = item.gcashRefNumber;
      } else {
        matchedItem.isMatch = false;
      }
    }

    return matchedItem;
  }).filter(item => {
    if (!item.isMatch) return false;

    let dateMatch = true;
    if (item.timestamp) {
      const itemDate = item.timestamp;
      dateMatch = itemDate >= dateRangeBounds.startCurrent && itemDate <= dateRangeBounds.endCurrent;
    }
    
    let paymentMatch = true;
    if (paymentFilter === 'Cash') {
      paymentMatch = item.paymentMethod === 'Cash' || !item.paymentMethod;
    } else if (paymentFilter === 'Cashless') {
      paymentMatch = item.paymentMethod !== 'Cash' && item.paymentMethod !== undefined;
    }

    return dateMatch && paymentMatch;
  });

  const ordersInSelectedPeriod = useMemo(() => {
    return reportData.filter((item) => {
      if (!item.timestamp) return false;
      return item.timestamp >= dateRangeBounds.startCurrent && item.timestamp <= dateRangeBounds.endCurrent;
    });
  }, [reportData, dateRangeBounds]);

  const expensesInSelectedPeriod = useMemo(() => {
    return expenseRecords.filter((e) => {
      if (!e.timestamp) return false;
      return e.timestamp >= dateRangeBounds.startCurrent && e.timestamp <= dateRangeBounds.endCurrent;
    });
  }, [expenseRecords, dateRangeBounds]);

  const cashReconciliation = useMemo(() => {
    const summary = summarizeCashFromOrderRows(ordersInSelectedPeriod);
    const totalExpenses = sumExpensesAmount(expensesInSelectedPeriod);
    const cashOnHand = computeCashOnHand(summary.totalSales, summary.digitalPayments, totalExpenses);
    return { ...summary, totalExpenses, cashOnHand };
  }, [ordersInSelectedPeriod, expensesInSelectedPeriod]);

  const utilityExpensesInSelectedPeriod = useMemo(
    () => expensesInSelectedPeriod.filter((e) => isUtilityExpense(e)),
    [expensesInSelectedPeriod]
  );

  const utilityExpenseTotal = useMemo(
    () => sumExpensesAmount(utilityExpensesInSelectedPeriod),
    [utilityExpensesInSelectedPeriod]
  );

  const utilityExpensePercentOfSales = useMemo(() => {
    if (cashReconciliation.totalSales <= 0) return 0;
    return (utilityExpenseTotal / cashReconciliation.totalSales) * 100;
  }, [cashReconciliation.totalSales, utilityExpenseTotal]);

  const utilityWithinTarget = utilityExpensePercentOfSales <= Number(utilityTargetPct || 0);

  const handleExpenseFormSubmit = (e) => {
    e.preventDefault();
    setExpenseFormError('');
    if (!currentUser?.uid) {
      setExpenseFormError('You must be signed in to add an expense.');
      return;
    }
    const raw = parseFloat(String(expenseAmount).replace(/,/g, ''));
    if (!Number.isFinite(raw) || raw <= 0) {
      setExpenseFormError('Enter a valid expense amount greater than zero.');
      return;
    }
    setPendingAddExpense({
      amount: raw,
      note: expenseNote.trim() || null,
      expenseType,
      expenseSubType: expenseSubType.trim() || null
    });
  };

  const closeAddExpenseModal = () => {
    if (!expenseSaving) {
      setPendingAddExpense(null);
      setExpenseFormError('');
    }
  };

  const confirmAddExpense = async () => {
    if (!pendingAddExpense || !currentUser?.uid) return;
    setExpenseSaving(true);
    setExpenseFormError('');
    try {
      await addDoc(collection(db, 'expenses'), {
        amount: pendingAddExpense.amount,
        description: pendingAddExpense.note,
        expenseType: pendingAddExpense.expenseType || 'Operational',
        expenseSubType: pendingAddExpense.expenseSubType || null,
        createdAt: serverTimestamp(),
        createdByUid: currentUser.uid,
        createdByName: currentUser.name || currentUser.email || 'Unknown',
        createdByEmail: currentUser.email || null
      });
      setExpenseAmount('');
      setExpenseNote('');
      setExpenseType('Operational');
      setExpenseSubType('');
      setPendingAddExpense(null);
      await loadExpenses();
    } catch (err) {
      console.error(err);
      setExpenseFormError('Could not save expense. Confirm Firestore rules allow create on `expenses`.');
    } finally {
      setExpenseSaving(false);
    }
  };

  const closeDeleteExpenseModal = () => {
    if (!deleteSaving) {
      setPendingDeleteExpense(null);
      setDeleteModalError('');
    }
  };

  const confirmDeleteExpense = async () => {
    if (!pendingDeleteExpense?.id) return;
    setDeleteSaving(true);
    setDeleteModalError('');
    try {
      await deleteDoc(doc(db, 'expenses', pendingDeleteExpense.id));
      setPendingDeleteExpense(null);
      await loadExpenses();
    } catch (err) {
      console.error(err);
      setDeleteModalError(
        'Could not delete. Ensure you are an Admin and Firestore rules allow delete on `expenses` for admins only.'
      );
    } finally {
      setDeleteSaving(false);
    }
  };

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
    let base = `${globalDateRange} Sales Report`;
    if (categoryFilter !== 'All Categories') {
      return `${base} for ${categoryFilter}`;
    }
    return base;
  };

  const getFileNamePrefix = () => {
    let base = `${globalDateRange.replace(/\s+/g, '_')}_Sales_Report`;
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
      'Payment Method': row.paymentMethod + (row.gcashRefNumber ? ` (Ref: ${row.gcashRefNumber})` : ''),
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
          <div className="flex items-center gap-2">
             <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Global Date Sync: {globalDateRange}</span>
          </div>

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="search-input !w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 hover:border-zinc-300 cursor-pointer"
          >
            <option>All Payments</option>
            <option>Cash</option>
            <option>Cashless</option>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
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

      {/* Cash flow & reconciliation (period = global date filter; all categories & payment types) */}
      <div className="bg-white p-5 rounded-xl border border-zinc-200 shadow-sm space-y-5">
        <div>
          <h3 className="font-bold text-sm text-zinc-900">{'Cash flow & reconciliation'}</h3>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-3xl">
            Totals below use the same date range as <span className="font-semibold text-zinc-600">{globalDateRange}</span> and include <span className="font-semibold text-zinc-600">all</span> orders (table filters do not change this). Digital payments (GCash, cards, etc.) are separated from cash so you can reconcile physical cash. Formula:{' '}
            <span className="font-mono text-[10px] bg-zinc-100 px-1.5 py-0.5 rounded">Cash on hand = Total sales − Digital payments − Expenses</span>.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Total sales</p>
            <p className="text-lg font-bold mt-1">₱{cashReconciliation.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">{ordersInSelectedPeriod.length} orders</p>
          </div>
          <div className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Digital / non-cash</p>
            <p className="text-lg font-bold mt-1 text-sky-900">₱{cashReconciliation.digitalPayments.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-sky-700/70 mt-0.5">{cashReconciliation.digitalCount} txns · not in cash drawer</p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Cash sales</p>
            <p className="text-lg font-bold mt-1 text-emerald-900">₱{cashReconciliation.cashSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-emerald-800/70 mt-0.5">{cashReconciliation.cashCount} txns · expected in drawer</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Expenses (period)</p>
            <p className="text-lg font-bold mt-1 text-amber-950">₱{cashReconciliation.totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-amber-900/70 mt-0.5">{expensesInSelectedPeriod.length} entries</p>
          </div>
          <div className="rounded-lg border-2 border-black bg-black p-3 text-white col-span-2 lg:col-span-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Cash on hand</p>
            <p className="text-xl font-bold mt-1">₱{cashReconciliation.cashOnHand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">End-of-period estimate</p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-zinc-800">Utility monitoring (electricity, water, internet)</p>
              <p className="text-[10px] text-zinc-500 mt-1">
                Tracks how utility expenses eat into gross sales for the selected date range.
              </p>
            </div>
            <label className="text-[10px] text-zinc-600 font-semibold flex items-center gap-2">
              Target %
              <input
                type="number"
                min="0"
                step="0.1"
                value={utilityTargetPct}
                onChange={(ev) => setUtilityTargetPct(Number(ev.target.value) || 0)}
                className="expense-form-input !w-20 !px-2 !py-1.5 text-xs"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Utility expenses</p>
              <p className="text-lg font-bold mt-1 text-violet-900">{formatPeso(utilityExpenseTotal)}</p>
              <p className="text-[10px] text-violet-700/70 mt-0.5">{utilityExpensesInSelectedPeriod.length} utility entries</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Utility % of gross sales</p>
              <p className="text-lg font-bold mt-1 text-indigo-900">{utilityExpensePercentOfSales.toFixed(2)}%</p>
              <p className="text-[10px] text-indigo-700/70 mt-0.5">Gross sales: {formatPeso(cashReconciliation.totalSales)}</p>
            </div>
            <div className={`rounded-lg border p-3 ${utilityWithinTarget ? 'border-emerald-100 bg-emerald-50/60' : 'border-rose-100 bg-rose-50/60'}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${utilityWithinTarget ? 'text-emerald-700' : 'text-rose-700'}`}>Target status</p>
              <p className={`text-lg font-bold mt-1 ${utilityWithinTarget ? 'text-emerald-900' : 'text-rose-900'}`}>
                {utilityWithinTarget ? 'Within target' : 'Over target'}
              </p>
              <p className={`text-[10px] mt-0.5 ${utilityWithinTarget ? 'text-emerald-700/70' : 'text-rose-700/70'}`}>
                Target: {Number(utilityTargetPct).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2 border-t border-zinc-100">
          <form onSubmit={handleExpenseFormSubmit} className="space-y-3">
            <p className="text-xs font-bold text-zinc-800">Record expense (cash out)</p>
            <p className="text-[10px] text-zinc-500">
              Track money that left the register (petty cash, supplies, payouts). It is subtracted from <span className="font-semibold text-zinc-600">Cash on hand</span> for the selected date range.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={expenseType}
                onChange={(ev) => setExpenseType(ev.target.value)}
                className="expense-form-input min-w-0"
              >
                <option value="Operational">Operational</option>
                <option value="Utility">Utility</option>
                <option value="Marketing">Marketing</option>
                <option value="Other">Other</option>
              </select>
              <select
                value={expenseSubType}
                onChange={(ev) => setExpenseSubType(ev.target.value)}
                className="expense-form-input min-w-0"
              >
                <option value="">Sub-type (optional)</option>
                <option value="Electricity">Electricity</option>
                <option value="Water">Water</option>
                <option value="Internet">Internet</option>
                <option value="Supplies">Supplies</option>
                <option value="Transport">Transport</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount (₱)"
                value={expenseAmount}
                onChange={(ev) => setExpenseAmount(ev.target.value)}
                className="expense-form-input min-w-0 flex-1"
              />
              <input
                type="text"
                placeholder="Note (optional)"
                value={expenseNote}
                onChange={(ev) => setExpenseNote(ev.target.value)}
                className="expense-form-input min-w-0 flex-[2]"
              />
              <button
                type="submit"
                disabled={!!pendingAddExpense || expenseSaving}
                className="px-4 py-2 bg-zinc-900 text-white text-xs font-bold rounded-lg hover:bg-zinc-800 disabled:opacity-50 shrink-0"
              >
                Add expense
              </button>
            </div>
            {expenseFormError && <p className="text-xs text-rose-600">{expenseFormError}</p>}
          </form>

          <div>
            <p className="text-xs font-bold text-zinc-800 mb-2">Expenses in this period</p>
            {expensesLoadError && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-2">{expensesLoadError}</p>
            )}
            <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-100 divide-y divide-zinc-50 text-sm">
              {expensesInSelectedPeriod.length === 0 ? (
                <p className="p-3 text-zinc-400 text-xs">No expenses recorded for this range.</p>
              ) : (
                expensesInSelectedPeriod.map((ex) => (
                  <div key={ex.id} className="px-3 py-2 flex justify-between gap-2 items-start">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-zinc-800">{formatPeso(ex.amount)}</p>
                      <p className="text-[9px] text-zinc-500 mt-0.5 uppercase tracking-wider">
                        {ex.expenseType || 'Operational'}{ex.expenseSubType ? ` · ${ex.expenseSubType}` : ''}
                      </p>
                      {ex.description ? <p className="text-[10px] text-zinc-500 truncate">{ex.description}</p> : null}
                      <p className="text-[9px] text-zinc-400 mt-0.5">
                        {ex.timestamp ? ex.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                      <p className="text-[9px] text-zinc-500 mt-0.5">
                        Recorded by {ex.createdByName || ex.createdByEmail || '—'}
                      </p>
                    </div>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteModalError('');
                          setPendingDeleteExpense({
                            id: ex.id,
                            amount: ex.amount,
                            description: ex.description || ''
                          });
                        }}
                        className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-700 px-2 py-1 rounded border border-rose-200 hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
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
                <th className="table-head-cell">Payment Method</th>
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
                    <div className="flex flex-col">
                      <span className="font-bold text-[11px] uppercase tracking-wider">{row.paymentMethod}</span>
                      {row.gcashRefNumber && <span className="text-[9px] text-zinc-400 mt-0.5">REF: {row.gcashRefNumber}</span>}
                    </div>
                  </td>
                  <td className="table-data-cell">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}

              {loading ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-zinc-400">
                    <div className="animate-spin text-3xl mb-2 inline-block">⏳</div>
                    <p>Loading transactions...</p>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-zinc-400">
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

      {pendingAddExpense ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/50 backdrop-blur-[1px]"
          role="presentation"
          onClick={closeAddExpenseModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-expense-title"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="confirm-expense-title" className="text-sm font-bold text-zinc-900">
              Confirm expense
            </h3>
            <p className="text-xs text-zinc-500 mt-2">Please confirm the amount is correct before saving.</p>
            <p className="text-2xl font-bold tracking-tight text-zinc-900 mt-4">{formatPeso(pendingAddExpense.amount)}</p>
            <p className="text-xs text-zinc-600 mt-3">
              <span className="font-semibold text-zinc-700">Category:</span>{' '}
              {pendingAddExpense.expenseType || 'Operational'}
              {pendingAddExpense.expenseSubType ? ` · ${pendingAddExpense.expenseSubType}` : ''}
            </p>
            {pendingAddExpense.note ? (
              <p className="text-xs text-zinc-600 mt-3">
                <span className="font-semibold text-zinc-700">Note:</span> {pendingAddExpense.note}
              </p>
            ) : (
              <p className="text-xs text-zinc-400 mt-3 italic">No note</p>
            )}
            <p className="text-[10px] text-zinc-500 mt-4">
              Will be saved as {currentUser?.name || currentUser?.email || 'your account'}.
            </p>
            {expenseFormError && pendingAddExpense ? (
              <p className="text-xs text-rose-600 mt-4">{expenseFormError}</p>
            ) : null}
            <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6">
              <button
                type="button"
                onClick={closeAddExpenseModal}
                disabled={expenseSaving}
                className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={confirmAddExpense}
                disabled={expenseSaving}
                className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-900 text-white text-xs font-bold hover:bg-zinc-800 disabled:opacity-50"
              >
                {expenseSaving ? 'Saving…' : 'Save expense'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDeleteExpense ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-900/50 backdrop-blur-[1px]"
          role="presentation"
          onClick={closeDeleteExpenseModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-expense-title"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="confirm-delete-expense-title" className="text-sm font-bold text-zinc-900">
              Delete expense?
            </h3>
            <p className="text-xs text-zinc-500 mt-2">This removes the entry from reports. This cannot be undone from the dashboard.</p>
            <p className="text-xl font-bold text-rose-700 mt-4">{formatPeso(pendingDeleteExpense.amount)}</p>
            {pendingDeleteExpense.description ? (
              <p className="text-xs text-zinc-600 mt-2 truncate" title={pendingDeleteExpense.description}>
                {pendingDeleteExpense.description}
              </p>
            ) : null}
            {deleteModalError ? <p className="text-xs text-rose-600 mt-4">{deleteModalError}</p> : null}
            <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6">
              <button
                type="button"
                onClick={closeDeleteExpenseModal}
                disabled={deleteSaving}
                className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteExpense}
                disabled={deleteSaving}
                className="flex-1 px-4 py-2.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
              >
                {deleteSaving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default SalesReport;
