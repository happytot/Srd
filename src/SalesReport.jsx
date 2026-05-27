import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, getDocs, orderBy, addDoc, serverTimestamp, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { Calendar, FileSpreadsheet, FileText, Loader2, ChevronDown } from 'lucide-react';
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
  const [discountFilter, setDiscountFilter] = useState('All Transactions'); const [reportData, setReportData] = useState([]);
  const [refundFilter, setRefundFilter] = useState('All Orders'); // NEW
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
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isReconciliationCollapsed, setIsReconciliationCollapsed] = useState(true);

  // NEW: Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const isAdmin = isAdminRole(currentUser?.role);

  // NEW: Dynamic Categories from Firestore (same as POS)
  const [dynamicCategories, setDynamicCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const dateRangeBounds = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let startCurrent = new Date(today);
    let endCurrent = new Date(today);
    endCurrent.setHours(23, 59, 59, 999);

    if (globalDateRange === 'Today') {
      startCurrent.setHours(0, 0, 0, 0);
    } else if (globalDateRange === 'Last 7 Days' || globalDateRange === 'Weekly') {
      startCurrent.setDate(startCurrent.getDate() - 6);
      startCurrent.setHours(0, 0, 0, 0);
    } else if (globalDateRange === 'Month to Date' || globalDateRange === 'Monthly') {
      startCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
      startCurrent.setHours(0, 0, 0, 0);
    } else if (globalDateRange === 'Last Quarter' || globalDateRange === 'Quarterly') {
      startCurrent.setDate(startCurrent.getDate() - 89);
      startCurrent.setHours(0, 0, 0, 0);
    } else if (globalDateRange === 'Annually') {
      startCurrent = new Date(now.getFullYear(), 0, 1);
      startCurrent.setHours(0, 0, 0, 0);
    } else if (globalDateRange === 'Custom') {
      if (globalCustomStart && globalCustomEnd) {
        startCurrent = new Date(globalCustomStart);
        startCurrent.setHours(0, 0, 0, 0);
        endCurrent = new Date(globalCustomEnd);
        endCurrent.setHours(23, 59, 59, 999);
      }
    } else {
      startCurrent.setDate(startCurrent.getDate() - 29);
      startCurrent.setHours(0, 0, 0, 0);
    }
    return { startCurrent, endCurrent };
  }, [globalDateRange, globalCustomStart, globalCustomEnd]);

  const getDateRangeDisplay = () => {
    if (globalDateRange === 'Custom' && globalCustomStart && globalCustomEnd) {
      const start = new Date(globalCustomStart).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const end = new Date(globalCustomEnd).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      return `${start} — ${end}`;
    }

    // For preset ranges
    const now = new Date();
    let startStr, endStr;

    switch (globalDateRange) {
      case 'Today':
        startStr = endStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        break;
      case 'Weekly':
      case 'Last 7 Days':
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - 6);
        startStr = weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        endStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        break;
      case 'Monthly':
      case 'Month to Date':
        startStr = new Date(now.getFullYear(), now.getMonth(), 1)
          .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        endStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        break;
      default:
        return `Period: ${globalDateRange}`;
    }

    return `${startStr} — ${endStr}`;
  };

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
        // Inside fetchOrders async function
        const data = querySnapshot.docs.map(doc => {
          const order = doc.data();
          const categories = order.items ? order.items.map(item => item.category) : [];
          const uniqueCategories = [...new Set(categories.filter(Boolean))];

          // === IMPROVED BARISTA DETECTION ===
          const barista = order.baristaName ||
            order.cashierName ||
            order.staffName ||
            'Guest';

          // === DISCOUNT DETECTION ===
          const hasDiscount = !!order.discount?.type ||
            order.items?.some(item => item.discountType && item.discountType !== 'None');

          const discountType = order.discount?.type ||
            order.items?.find(item => item.discountType && item.discountType !== 'None')?.discountType || null;

          return {
            id: doc.id,
            transactionId: order.transactionNumber || order.transactionId || doc.id,
            date: order.createdAt
              ? order.createdAt.toDate().toLocaleString('en-US', {
                month: '2-digit',
                day: '2-digit',
                year: '2-digit',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              }).replace(',', '')
              : 'N/A',
            timestamp: order.createdAt ? order.createdAt.toDate() : new Date(0),
            product: order.items ? order.items.map(item => `${item.quantity || 1}x ${item.name}`).join(', ') : 'Unknown',
            category: uniqueCategories.length === 1 ? uniqueCategories[0] : (uniqueCategories.length > 1 ? 'Multiple' : 'Unknown'),
            categories: uniqueCategories,
            amount: Number(order.totalAmount) || 0,
            originalTotalAmount: Number(order.totalAmount) || 0,
            originalItems: order.items || [],
            status: order.status || 'Completed',
            barista: barista,
            paymentMethod: order.paymentMethod || 'Cash',
            gcashRefNumber: order.gcashRefNumber || '',
            hasDiscount,
            discountType
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

  // Load dynamic categories from Firestore (same as POS)
  useEffect(() => {
    const catsSet = new Set(); // Prevent duplicates

    const unsubscribe = onSnapshot(collection(db, "categories"), (snapshot) => {
      const cats = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.name) {
          catsSet.add(data.name);           // Use Set to remove duplicates
        }
      });

      setDynamicCategories(Array.from(catsSet).sort((a, b) => a.localeCompare(b)));
      setCategoriesLoading(false);
    });

    return () => unsubscribe();
  }, []);
  const filteredData = reportData.map(item => {
    let matchedItem = { ...item, isMatch: true };

    // Category Filter
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

    // NEW: Discount Filter
    if (discountFilter !== 'All Transactions' && matchedItem.isMatch) {
      const hasAnyDiscount = item.originalItems.some(i =>
        i.discountType && i.discountType !== 'None'
      );

      if (discountFilter === 'No Discount') {
        if (hasAnyDiscount) matchedItem.isMatch = false;
      }
      else if (discountFilter === 'With Discount') {
        if (!hasAnyDiscount) matchedItem.isMatch = false;
      }
      else {
        const hasSpecificDiscount = item.originalItems.some(i =>
          i.discountType === discountFilter
        );
        if (!hasSpecificDiscount) matchedItem.isMatch = false;
      }
    }

    // NEW: Refund Status Filter
    if (refundFilter !== 'All Orders' && matchedItem.isMatch) {
      const orderStatus = item.status || 'Completed';
      if (refundFilter === 'Completed' && orderStatus === 'refunded') {
        matchedItem.isMatch = false;
      }
      if (refundFilter === 'Refunded' && orderStatus !== 'refunded') {
        matchedItem.isMatch = false;
      }
    }

    return matchedItem;
  }).filter(item => {
    if (!item.isMatch) return false;

    // Date Filter
    let dateMatch = true;
    if (item.timestamp) {
      const itemDate = item.timestamp;
      dateMatch = itemDate >= dateRangeBounds.startCurrent && itemDate <= dateRangeBounds.endCurrent;
    }

    // Payment Filter
    let paymentMatch = true;
    if (paymentFilter === 'Cash') {
      paymentMatch = item.paymentMethod === 'Cash' || !item.paymentMethod;
    } else if (paymentFilter === 'Cashless') {
      paymentMatch = item.paymentMethod !== 'Cash' && item.paymentMethod !== undefined;
    }

    return dateMatch && paymentMatch;
  });

  // NEW: Pagination logic
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [categoryFilter, paymentFilter, discountFilter, refundFilter, globalDateRange, globalCustomStart, globalCustomEnd]);

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

  const handleExpenseFormSubmit = async (e) => {
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

    setExpenseSaving(true);

    try {
      await addDoc(collection(db, 'expenses'), {
        amount: raw,
        description: expenseNote.trim() || null,
        expenseType: expenseType || 'Operational',
        expenseSubType: expenseSubType.trim() || null,
        createdAt: serverTimestamp(),
        createdByUid: currentUser.uid,
        createdByName: currentUser.name || currentUser.email || 'Unknown',
        createdByEmail: currentUser.email || null
      });

      setExpenseAmount('');
      setExpenseNote('');
      setExpenseSubType('');
      await loadExpenses();

      // Log to Activity Logs
      try {
        await addDoc(collection(db, 'activity_logs'), {
          uid: currentUser.uid,
          name: currentUser.name || currentUser.email || 'Unknown User',
          role: currentUser.role || 'staff',
          subsystem: 'SRD',
          action: 'ADD_EXPENSE',
          meta: {
            amount: raw,
            expenseType: expenseType,
            expenseSubType: expenseSubType || null,
            description: expenseNote || null
          },
          createdAt: serverTimestamp()
        });
      } catch (logErr) {
        console.warn("Failed to log expense addition:", logErr);
      }

      // Show success modal
      setShowSuccessModal(true);

    } catch (err) {
      console.error(err);
      setExpenseFormError('Could not save expense. Check Firestore rules.');
    } finally {
      setExpenseSaving(false);
    }
  };

  const confirmDeleteExpense = async () => {
    if (!pendingDeleteExpense?.id) return;
    setDeleteSaving(true);
    try {
      await deleteDoc(doc(db, 'expenses', pendingDeleteExpense.id));

      // Log to Activity Logs
      try {
        await addDoc(collection(db, 'activity_logs'), {
          uid: currentUser.uid,
          name: currentUser.name || currentUser.email || 'Unknown User',
          role: currentUser.role || 'staff',
          subsystem: 'SRD',
          action: 'DELETE_EXPENSE',
          meta: {
            expenseId: pendingDeleteExpense.id,
            amount: pendingDeleteExpense.amount,
            description: pendingDeleteExpense.description || null
          },
          createdAt: serverTimestamp()
        });
      } catch (logErr) {
        console.warn("Failed to log expense deletion:", logErr);
      }

      setPendingDeleteExpense(null);
      await loadExpenses();
    } catch (err) {
      console.error(err);
      setDeleteModalError('Could not delete expense.');
    } finally {
      setDeleteSaving(false);
    }
  };

  const totalRevenue = filteredData.reduce((sum, item) => sum + item.amount, 0);
  const averageTransaction = filteredData.length ? totalRevenue / filteredData.length : 0;

  const getStatusColor = (status) => {
    switch (String(status).toLowerCase()) {
      case 'completed':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'refunded':
        return 'text-rose-600 bg-rose-50 border-rose-200';
      case 'pending':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      default:
        return 'text-zinc-600 bg-zinc-50 border-zinc-200';
    }
  };

  const getPaymentBadge = (method) => {
    const m = String(method || 'Cash').toLowerCase();
    if (m === 'cash') return <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">Cash</span>;
    if (m === 'gcash') return <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200">GCash</span>;
    if (m === 'maya') return <span className="px-3 py-1 rounded-full text-xs font-bold bg-violet-100 text-violet-700 border border-violet-200">Maya</span>;
    return <span className="px-3 py-1 rounded-full text-xs font-bold bg-zinc-100 text-zinc-600 border border-zinc-200">Cashless</span>;
  };

  const getReportName = () => {
    let base = `${globalDateRange} Sales Report`;

    if (refundFilter === 'Refunded') {
      base = `${globalDateRange} Refunded Orders`;
    } else if (refundFilter === 'Completed') {
      base = `${globalDateRange} Completed Orders`;
    }

    if (categoryFilter !== 'All Categories') {
      base += ` • ${categoryFilter}`;
    }
    if (discountFilter !== 'All Transactions') {
      base += ` • ${discountFilter}`;
    }

    return base;
  };

  const getFileNamePrefix = () => {
    let base = `${globalDateRange.replace(/\s+/g, '_')}`;

    if (refundFilter === 'Refunded') {
      base += `_Refunded_Orders`;
    } else if (refundFilter === 'Completed') {
      base += `_Completed_Orders`;
    } else {
      base += `_Sales_Report`;
    }

    if (categoryFilter !== 'All Categories') {
      base += `_${categoryFilter.replace(/\s+/g, '_')}`;
    }
    if (discountFilter !== 'All Transactions') {
      base += `_${discountFilter.replace(/\s+/g, '_')}`;
    }

    return base;
  };

  const generateExportData = () => {
    return filteredData.map(row => ({
      'Transaction ID': row.transactionId || row.id,   // Full ID
      'Date': row.date,
      'Barista': row.customer,
      'Items': row.product,
      'Category': row.category,
      'Amount': Number(row.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }), 'Payment Method': row.paymentMethod + (row.gcashRefNumber ? ` (Ref: ${row.gcashRefNumber})` : ''),
      'Status': row.status
    }));
  };

  const handleExportExcel = () => {
    const exportData = generateExportData();
    if (exportData.length === 0) return;
    ExportEngine.exportToExcel(
      exportData,
      getFileNamePrefix(),
      'Coffee and Tea Connection',
      getReportName(),
      categoryFilter,
      discountFilter   // ← Added
    );
  };

  const handleExportPDF = () => {
    const exportData = generateExportData();
    if (exportData.length === 0) return;

    // Generate nice date range string for PDF
    const dateRangeInfo = getDateRangeDisplay();

    let reportSubtitle = `${globalDateRange} Sales Report`;
    if (categoryFilter !== 'All Categories') {
      reportSubtitle += ` • ${categoryFilter}`;
    }
    if (discountFilter !== 'All Transactions') {
      reportSubtitle += ` • ${discountFilter}`;
    }

    ExportEngine.exportToPDF(
      exportData,
      getFileNamePrefix(),
      'Coffee & Tea Connection',
      reportSubtitle,
      dateRangeInfo,           // ← NEW: Pass date range here
      categoryFilter,
      discountFilter
    );
  };

  // Pagination handlers
  const goToPreviousPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  return (
    <div id="sales-report-content" className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 bg-zinc-50 pb-8">

      {/* NEW: Custom Date Range Display */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <h1 className="text-3xl font-bold text-zinc-900">Sales Report</h1>

        {globalDateRange === 'Custom' && globalCustomStart && globalCustomEnd && (
          <div className="flex items-center gap-2 bg-black border border-zinc-800 text-white shadow-md shadow-black/10 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 hover:scale-[1.01] hover:shadow-lg">
            <Calendar size={14} className="text-white animate-pulse" />
            <span className="text-zinc-400 font-normal">Coverage:</span>
            <span className="font-bold text-white">
              {new Date(globalCustomStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-zinc-500 font-normal">—</span>
            <span className="font-bold text-white">
              {new Date(globalCustomEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        )}
      </div>

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
            disabled={categoriesLoading}
          >
            <option>All Categories</option>
            {[...new Set(dynamicCategories)].map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Discount Filter - Improved Labels */}
          <select
            value={discountFilter}
            onChange={(e) => setDiscountFilter(e.target.value)}
            className="search-input !w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 hover:border-zinc-300 cursor-pointer"
          >
            <option value="All Transactions">All Transactions</option>
            <option value="No Discount">No Discount</option>
            <option value="With Discount">With Discount</option>
            <option value="PWD">PWD Discount</option>
            <option value="Senior">Senior Discount</option>
          </select>
        </div>

        {/* NEW: Refund Status Filter */}
        <select
          value={refundFilter}
          onChange={(e) => setRefundFilter(e.target.value)}
          className="search-input !w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 hover:border-zinc-300 cursor-pointer"
        >
          <option value="All Orders">All Orders</option>
          <option value="Completed">Completed Only</option>
          <option value="Refunded">Refunded Only</option>
        </select>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button onClick={handleExportExcel} className="flex-1 sm:flex-none px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 transition-all active:scale-[0.98] flex items-center justify-center">
            <FileSpreadsheet size={14} className="mr-1.5" /> Excel
          </button>
          <button onClick={handleExportPDF} className="flex-1 sm:flex-none px-3 py-2 bg-white border border-rose-200 rounded-lg text-xs font-bold text-rose-700 shadow-sm hover:bg-rose-50 transition-all active:scale-[0.98] flex items-center justify-center">
            <FileText size={14} className="mr-1.5" /> PDF
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mb-6">
        <div className="stat-card">
          <p className="stat-card-title">Filtered Revenue</p>
          <p className="stat-card-value">₱{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-title">Transaction Count</p>
          <p className="stat-card-value">{filteredData.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-title">Average Transaction (Daily)</p>
          <p className="stat-card-value">₱{averageTransaction.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>


      {/* Cash flow & reconciliation */}

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden transition-all duration-300">
        <button
          type="button"
          onClick={() => setIsReconciliationCollapsed(!isReconciliationCollapsed)}
          className="w-full text-left p-5 flex justify-between items-center bg-white hover:bg-zinc-50 transition-colors focus:outline-none cursor-pointer"
        >
          <div>
            <h3 className="font-bold text-sm text-zinc-900 flex items-center gap-2">
              Cash flow & reconciliation
            </h3>
            <p className="text-[11px] text-zinc-500 mt-1 max-w-3xl">
              Physical cash drawer audit and period expense recording synced to <span className="font-semibold text-zinc-600">{globalDateRange}</span>.
            </p>
          </div>
          <div className="flex items-center gap-2 text-zinc-400 hover:text-zinc-600 shrink-0">
            {isReconciliationCollapsed ? (
              <span className="text-[10px] bg-zinc-100 text-zinc-600 font-bold px-2 py-0.5 rounded-full">
                Show details
              </span>
            ) : null}
            <div className={`transform transition-transform duration-300 ${isReconciliationCollapsed ? '' : 'rotate-180'}`}>
              <ChevronDown size={18} />
            </div>
          </div>
        </button>

        <div className={`transition-all duration-550 ease-in-out overflow-hidden ${isReconciliationCollapsed ? 'max-h-0' : 'max-h-[1500px] border-t border-zinc-100 p-5 space-y-5'
          }`}>
          <div>
            <p className="text-[11px] text-zinc-500 max-w-3xl leading-relaxed">
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
      </div>

      {/* Detailed Data Table with Pagination */}
      <div className="table-container mt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell px-3">Transaction ID</th>
                <th className="table-head-cell px-3">Date</th>
                <th className="table-head-cell px-3">Barista</th>
                <th className="table-head-cell px-4">Items</th>
                <th className="table-head-cell px-1 text-right">Amount</th>
                <th className="table-head-cell px-3">Payment Method</th>
                <th className="table-head-cell px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {paginatedData.map((row) => (
                <tr key={row.id} className="table-row">
                  <td className="table-data-cell px-3 py-3 font-mono text-zinc-500 whitespace-nowrap" title={row.transactionId}>                    {row.transactionId}
                  </td>
                  <td className="table-data-cell px-3 py-3 text-zinc-600 whitespace-nowrap">{row.date}</td>
                  {/* Barista Column */}
                  <td className="table-data-cell font-medium text-zinc-800">
                    {row.barista}
                  </td>

                  <td className="table-data-cell">
                    <div className="max-w-[260px]">
                      <p className="font-bold truncate" title={row.product}>{row.product}</p>
                      <p className="text-[10px] text-zinc-400 uppercase tracking-wider truncate" title={row.category}>
                        {row.category}
                      </p>
                    </div>
                  </td>

                  <td className="table-data-cell px-3 py-3 font-bold text-right">{formatPeso(row.amount)}</td>
                  <td className="table-data-cell px-3 py-3">                    {getPaymentBadge(row.paymentMethod)}
                    {row.gcashRefNumber && <span className="text-[9px] text-zinc-400 ml-2">REF: {row.gcashRefNumber}</span>}
                  </td>

                  <td className="table-data-cell">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(row.status)}`}>
                        {row.status}
                      </span>

                      {/* Discount Indicator - Clean Pill */}
                      {row.hasDiscount && (
                        <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                          {row.discountType ? `${row.discountType} DISCOUNTED` : 'DISCOUNTED'}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {loading ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-zinc-400">
                    <Loader2 className="animate-spin mb-2 inline-block" size={32} />
                    <p>Loading transactions...</p>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-zinc-400">
                    <div className="flex justify-center mb-2">
                      <FileSpreadsheet size={48} className="text-zinc-300" />
                    </div>
                    <p>No transactions found for the selected filters.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-4 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500 bg-zinc-50/50">
          <span>
            Showing {filteredData.length > 0 ? startIndex + 1 : 0} to {Math.min(startIndex + itemsPerPage, filteredData.length)} of {filteredData.length} entries
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={goToPreviousPage}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="px-3 py-1 bg-black text-white rounded">
              Page {currentPage} of {totalPages || 1}
            </span>
            <button
              onClick={goToNextPage}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* SUCCESS MODAL AFTER ADDING EXPENSE */}
      {showSuccessModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="text-4xl">✅</span>
            </div>
            <h3 className="text-2xl font-bold text-emerald-700 mb-2">Expense Added!</h3>
            <p className="text-zinc-600 mb-6">The expense has been recorded successfully.</p>
            <button
              onClick={() => setShowSuccessModal(false)}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-all"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL FOR EXPENSES */}
      {pendingDeleteExpense && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-rose-600 mb-2">Delete Expense?</h3>
            <p className="text-zinc-600 mb-6">
              Are you sure you want to delete this expense of <strong>{formatPeso(pendingDeleteExpense.amount)}</strong>?
              <br />This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingDeleteExpense(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteExpense}
                disabled={deleteSaving}
                className="flex-1 py-3 rounded-xl font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-all disabled:opacity-50"
              >
                {deleteSaving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            {deleteModalError && (
              <p className="text-rose-600 text-sm mt-3 text-center">{deleteModalError}</p>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default SalesReport;