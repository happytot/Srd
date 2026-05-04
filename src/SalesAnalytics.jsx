import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { Link, Loader2, Download, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import ExportEngine from './utils/ExportEngine';

const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

const SalesAnalytics = ({ globalDateRange, globalCustomStart, globalCustomEnd }) => {
  const [timeGranularity, setTimeGranularity] = useState('Daily');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    try {
      const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const data = snapshot.docs.map(doc => {
        const order = doc.data();
        const categories = order.items ? order.items.map(item => item.category) : [];
        const uniqueCategories = [...new Set(categories.filter(Boolean))];

        return {
          id: doc.id,
          timestamp: order.createdAt ? order.createdAt.toDate() : new Date(0),
          items: order.items || [],
          amount: Number(order.totalAmount) || 0,
          categories: uniqueCategories,
        };
      });
      
      setReportData(data);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Date Range Filtering
  const { currentPeriodData, previousPeriodData } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let startCurrent = new Date(today);
    let endCurrent = new Date(today);
    endCurrent.setHours(23, 59, 59, 999);
    
    let startPrev = new Date(today);
    let endPrev = new Date(today);

    if (globalDateRange === 'Today') {
      startCurrent.setHours(0, 0, 0, 0);
      startPrev.setDate(startPrev.getDate() - 1);
      startPrev.setHours(0, 0, 0, 0);
      endPrev.setHours(23, 59, 59, 999);
    } 
    else if (globalDateRange === 'Last 7 Days') {
      startCurrent.setDate(startCurrent.getDate() - 6);
      startCurrent.setHours(0, 0, 0, 0);
      startPrev.setDate(startCurrent.getDate() - 7);
      endPrev.setDate(startCurrent.getDate() - 1);
      endPrev.setHours(23, 59, 59, 999);
    } 
    else if (globalDateRange === 'Month to Date') {
      startCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
      startCurrent.setHours(0, 0, 0, 0);
      startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endPrev = new Date(startPrev);
      endPrev.setDate(endPrev.getDate() + (now.getDate() - 1));
      endPrev.setHours(23, 59, 59, 999);
    } 
    else if (globalDateRange === 'Last Quarter') {
      startCurrent.setDate(startCurrent.getDate() - 89);
      startCurrent.setHours(0, 0, 0, 0);
      startPrev.setDate(startCurrent.getDate() - 90);
      endPrev.setDate(startCurrent.getDate() - 1);
      endPrev.setHours(23, 59, 59, 999);
    } 
    else if (globalDateRange === 'Custom' && globalCustomStart && globalCustomEnd) {
      startCurrent = new Date(globalCustomStart);
      startCurrent.setHours(0, 0, 0, 0);
      endCurrent = new Date(globalCustomEnd);
      endCurrent.setHours(23, 59, 59, 999);
      
      const diffTime = endCurrent.getTime() - startCurrent.getTime();
      startPrev = new Date(startCurrent.getTime() - diffTime - 86400000);
      endPrev = new Date(startCurrent.getTime() - 86400000);
      endPrev.setHours(23, 59, 59, 999);
    } 
    else {
      // Default: Last 30 days
      startCurrent.setDate(startCurrent.getDate() - 29);
      startCurrent.setHours(0, 0, 0, 0);
      startPrev.setDate(startCurrent.getDate() - 30);
      endPrev.setDate(startCurrent.getDate() - 1);
      endPrev.setHours(23, 59, 59, 999);
    }

    const current = reportData.filter(item => 
      item.timestamp >= startCurrent && item.timestamp <= endCurrent
    );
    const prev = reportData.filter(item => 
      item.timestamp >= startPrev && item.timestamp <= endPrev
    );

    return { currentPeriodData: current, previousPeriodData: prev };
  }, [reportData, globalDateRange, globalCustomStart, globalCustomEnd]);

  // Time Series Data
  const timeSeriesData = useMemo(() => {
    const agg = {};
    
    currentPeriodData.forEach(order => {
      const d = order.timestamp;
      let key = '';
      let sortKey = '';

      if (timeGranularity === 'Daily') {
        key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        sortKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      } 
      else if (timeGranularity === 'Monthly') {
        key = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        sortKey = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      } 
      else if (timeGranularity === 'Quarterly') {
        const q = Math.floor(d.getMonth() / 3) + 1;
        key = `Q${q} ${d.getFullYear()}`;
        sortKey = new Date(d.getFullYear(), (q - 1) * 3, 1).getTime();
      } 
      else if (timeGranularity === 'Yearly') {
        key = `${d.getFullYear()}`;
        sortKey = new Date(d.getFullYear(), 0, 1).getTime();
      }

      if (!agg[sortKey]) {
        agg[sortKey] = { dateLabel: key, sales: 0, count: 0 };
      }
      agg[sortKey].sales += order.amount;
      agg[sortKey].count += 1;
    });

    return Object.keys(agg)
      .sort((a, b) => Number(a) - Number(b))
      .map(k => agg[k]);
  }, [currentPeriodData, timeGranularity]);

  // Category Breakdown
  const categoryData = useMemo(() => {
    const catMap = {};
    
    currentPeriodData.forEach(order => {
      order.items.forEach(item => {
        const c = item.category || 'Uncategorized';
        if (!catMap[c]) catMap[c] = { name: c, value: 0, quantity: 0 };
        catMap[c].value += (item.price || 0) * (item.quantity || 1);
        catMap[c].quantity += (item.quantity || 1);
      });
    });
    
    return Object.values(catMap).sort((a, b) => b.value - a.value);
  }, [currentPeriodData]);

  // Metrics
  const currentRevenue = currentPeriodData.reduce((acc, curr) => acc + curr.amount, 0);
  const previousRevenue = previousPeriodData.reduce((acc, curr) => acc + curr.amount, 0);
  const revenueVariance = previousRevenue === 0 ? 100 : ((currentRevenue - previousRevenue) / previousRevenue) * 100;

  const currentOrders = currentPeriodData.length;
  const previousOrders = previousPeriodData.length;
  const ordersVariance = previousOrders === 0 ? 100 : ((currentOrders - previousOrders) / previousOrders) * 100;

  const currentAvg = currentOrders === 0 ? 0 : currentRevenue / currentOrders;
  const previousAvg = previousOrders === 0 ? 0 : previousRevenue / previousOrders;
  const avgVariance = previousAvg === 0 ? 100 : ((currentAvg - previousAvg) / previousAvg) * 100;

  const VarianceBadge = ({ value }) => {
    const isPositive = value >= 0;
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPositive ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
        {isPositive ? '+' : ''}{value.toFixed(1)}% vs Prev
      </span>
    );
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-black text-white p-3 rounded-lg text-xs shadow-xl z-50">
          <p className="font-bold text-zinc-300 mb-1">{label}</p>
          <p className="text-sm font-bold">₱{payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          {payload[0].payload.count !== undefined && (
            <p className="text-zinc-400 mt-1">{payload[0].payload.count} Transactions</p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
            Global Date Sync: {globalDateRange}
          </span>
          
          <select 
            value={timeGranularity} 
            onChange={(e) => setTimeGranularity(e.target.value)}
            className="search-input !w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 cursor-pointer"
          >
            <option>Daily</option>
            <option>Monthly</option>
            <option>Quarterly</option>
            <option>Yearly</option>
          </select>
        </div>

        <div className="px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-bold text-zinc-400 shadow-sm cursor-not-allowed hidden md:block flex items-center justify-center">
          <Link size={14} className="inline mr-1.5" /> Synced
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-zinc-400 bg-white rounded-xl border border-zinc-200 shadow-sm">
          <Loader2 className="animate-spin mb-2 mr-3 inline-block" size={32} />
          <p>Processing Analytics...</p>
        </div>
      ) : (
        <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="content-card flex flex-col justify-between h-full hover:border-black transition-colors duration-300">
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Total Revenue</p>
                <p className="text-3xl font-black tracking-tight">₱{currentRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <VarianceBadge value={revenueVariance} />
                <span className="text-[10px] text-zinc-400">vs prev period</span>
              </div>
            </div>

            <div className="content-card flex flex-col justify-between h-full hover:border-black transition-colors duration-300">
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Total Orders</p>
                <p className="text-3xl font-black tracking-tight">{currentOrders.toLocaleString()}</p>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <VarianceBadge value={ordersVariance} />
                <span className="text-[10px] text-zinc-400">vs prev period</span>
              </div>
            </div>

            <div className="content-card flex flex-col justify-between h-full hover:border-black transition-colors duration-300">
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Avg Order Value</p>
                <p className="text-3xl font-black tracking-tight">₱{currentAvg.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <VarianceBadge value={avgVariance} />
                <span className="text-[10px] text-zinc-400">vs prev period</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sales Trend Chart */}
            <div className="lg:col-span-2 content-card">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-lg leading-tight">Sales Fluctuation</h3>
                  <p className="text-xs text-zinc-400">{timeGranularity} view of revenue vs time</p>
                </div>
                <button 
                  onClick={() => ExportEngine.exportToImage('analytics-area-chart', 'Sales_Trend')}
                  className="px-2 py-1 text-[10px] font-bold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 rounded transition-colors flex items-center justify-center"
                >
                  <Download size={14} className="mr-1.5" /> Export PNG
                </button>
              </div>

              <div id="analytics-area-chart" className="h-[300px] w-full mt-4 bg-white p-2">
                {timeSeriesData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeSeriesData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#000" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#000" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                      <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={{ fill: '#a1a1aa', fontSize: 12 }} dy={10} />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#a1a1aa', fontSize: 12 }} 
                        tickFormatter={(value) => `₱${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`} 
                        dx={-10} 
                      />
                      <RechartsTooltip content={<CustomTooltip />} />
                      <Area 
                        type="monotone" 
                        dataKey="sales" 
                        stroke="#000" 
                        strokeWidth={3} 
                        fillOpacity={1} 
                        fill="url(#colorSales)" 
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#000' }} 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400">
                    <TrendingUp size={48} className="mb-2 text-zinc-300" />
                    <p className="text-sm">No trend data available for this range</p>
                  </div>
                )}
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="content-card flex flex-col">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-bold text-lg mb-1">Category Breakdown</h3>
                  <p className="text-xs text-zinc-400">Revenue share by product type</p>
                </div>
                <button 
                  onClick={() => ExportEngine.exportToImage('analytics-pie-chart', 'Category_Breakdown')}
                  className="px-2 py-1 text-[10px] font-bold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 rounded transition-colors flex items-center justify-center"
                >
                  <Download size={14} className="mr-1.5" /> Export
                </button>
              </div>

              <div id="analytics-pie-chart" className="flex-1 min-h-[250px] relative bg-white pb-4">
                {categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="45%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip formatter={(value) => `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400">
                    <p className="text-sm">No category data</p>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 max-h-[120px] overflow-y-auto pr-2">
                {categoryData.map((cat, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></span>
                      <span className="font-bold truncate max-w-[100px]">{cat.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-400">{((cat.value / currentRevenue) * 100).toFixed(1)}%</span>
                      <span className="font-bold">₱{cat.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SalesAnalytics;