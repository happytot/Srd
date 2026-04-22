import { useState, useEffect, useMemo } from 'react'
import { auth, db } from './firebase'
import { doc, getDoc, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import LoginPage from './LoginPage'
import SalesReport from './SalesReport'
import InventoryAlerts from './InventoryAlerts'
import UserManagement from './UserManagement'
import SalesAnalytics from './SalesAnalytics'
import SalesForecasting from './SalesForecasting'
import ActivityLogs from './ActivityLogs'
import GlobalDateFilter from './components/GlobalDateFilter'
import AppSidebar from './components/AppSidebar'
import {
  endUserSession,
  heartbeatSession,
  logUserAction,
  startUserSession
} from './utils/userActivityLogger'
import { isAdminRole } from './utils/roles'

const StatCard = ({ title, value, subtext, icon }) => (
  <div className="stat-card">
    <div className="flex justify-between items-start">
      <p className="stat-card-title">{title}</p>
      <span className="text-zinc-400">{icon}</span>
    </div>
    <p className="stat-card-value">{value}</p>
    <p className="text-xs text-zinc-500 mt-1 flex gap-1">
      <span className={subtext.includes('+') ? "text-emerald-600 font-bold" : ""}>{subtext.split(' ')[0]}</span>
      <span className="text-zinc-400 inline-block">{subtext.split(' ').slice(1).join(' ')}</span>
    </p>
  </div>
);

const Overview = ({ globalDateRange, globalCustomStart, globalCustomEnd }) => {
  const [stats, setStats] = useState({
    currentRevenue: 0,
    previousRevenue: 0,
    currentOrders: 0,
    previousOrders: 0,
    currentAvg: 0,
    previousAvg: 0,
    topProduct: 'N/A',
    topProductSales: 0,
    bestSelling: [],
    leastSelling: [],
    lowStock: [],
    salesTrend: []
  });
  const [allOrders, setAllOrders] = useState([]);

  const trendDays = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (globalDateRange === 'Today') return 1;
    if (globalDateRange === 'Weekly' || globalDateRange === 'Last 7 Days') return 7;

    if (globalDateRange === 'Monthly' || globalDateRange === 'Month to Date') {
      return now.getDate(); // Days passed in current month
    }

    if (globalDateRange === 'Quarterly' || globalDateRange === 'Last Quarter') {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1);
      return Math.max(1, Math.ceil((today - quarterStart) / (1000 * 60 * 60 * 24)) + 1);
    }

    if (globalDateRange === 'Annually') {
      const yearStart = new Date(now.getFullYear(), 0, 1);
      return Math.max(1, Math.ceil((today - yearStart) / (1000 * 60 * 60 * 24)) + 1);
    }

    if (globalDateRange === 'Custom') {
      if (globalCustomStart && globalCustomEnd) {
        const start = new Date(globalCustomStart);
        const end = new Date(globalCustomEnd);
        return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
      }
      return 30;
    }
    return 7; // fallback
  }, [globalDateRange, globalCustomStart, globalCustomEnd]);

  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      setAllOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const inventoryQuery = query(collection(db, 'inventory'), where('status', '!=', 'deleted'));
    const unsubInventory = onSnapshot(inventoryQuery, (snapshot) => {
      const lowStockList = [];
      snapshot.docs.forEach(doc => {
        const inv = doc.data();
        const qty = Number(inv.quantity) || 0;
        const threshold = Number(inv.lowStockThreshold) || Math.max(10, qty * 0.1);

        let status = 'Normal';
        if (qty <= threshold * 0.3) status = 'Critical';
        else if (qty <= threshold || inv.isLowStock) status = 'Low';

        if (status !== 'Normal') {
          lowStockList.push({ id: doc.id, name: inv.name || 'Unnamed', status });
        }
      });
      lowStockList.sort((a, b) => (a.status === 'Critical' ? -1 : 1));

      setStats(prev => ({
        ...prev,
        lowStock: lowStockList.slice(0, 4)
      }));
      setLoading(false);
    });

    return () => {
      unsubOrders();
      unsubInventory();
    };
  }, []);

  useEffect(() => {
    if (loading) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let startCurrent = new Date(today);
    let endCurrent = new Date(today);
    endCurrent.setHours(23, 59, 59, 999);
    
    let startPrev = new Date(today);
    let endPrev = new Date(today);

    if (globalDateRange === 'Today') {
      startCurrent.setHours(0,0,0,0);
      
      startPrev.setDate(startPrev.getDate() - 1);
      startPrev.setHours(0,0,0,0);
      endPrev = new Date(startPrev);
      endPrev.setHours(23,59,59,999);
    } else if (globalDateRange === 'Last 7 Days' || globalDateRange === 'Weekly') {
      startCurrent.setDate(startCurrent.getDate() - 6);
      startCurrent.setHours(0,0,0,0);
      
      startPrev.setDate(startCurrent.getDate() - 7);
      endPrev.setDate(startCurrent.getDate() - 1);
      endPrev.setHours(23,59,59,999);
    } else if (globalDateRange === 'Month to Date' || globalDateRange === 'Monthly') {
      startCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
      startCurrent.setHours(0,0,0,0);
      
      startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endPrev = new Date(startPrev);
      endPrev.setDate(endPrev.getDate() + (now.getDate() - 1));
      endPrev.setHours(23,59,59,999);
    } else if (globalDateRange === 'Last Quarter' || globalDateRange === 'Quarterly') {
      startCurrent.setDate(startCurrent.getDate() - 89);
      startCurrent.setHours(0,0,0,0);
      
      startPrev.setDate(startCurrent.getDate() - 90);
      endPrev.setDate(startCurrent.getDate() - 1);
      endPrev.setHours(23,59,59,999);
    } else if (globalDateRange === 'Annually') {
      startCurrent = new Date(now.getFullYear(), 0, 1);
      startCurrent.setHours(0,0,0,0);
      
      startPrev = new Date(now.getFullYear() - 1, 0, 1);
      endPrev = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      endPrev.setHours(23,59,59,999);
    } else if (globalDateRange === 'Custom') {
      if (globalCustomStart && globalCustomEnd) {
        startCurrent = new Date(globalCustomStart);
        startCurrent.setHours(0,0,0,0);
        endCurrent = new Date(globalCustomEnd);
        endCurrent.setHours(23,59,59,999);
        
        const diffTime = endCurrent.getTime() - startCurrent.getTime();
        startPrev = new Date(startCurrent.getTime() - diffTime - 86400000);
        endPrev = new Date(startCurrent.getTime() - 86400000);
        endPrev.setHours(23,59,59,999);
      }
    } else {
      startCurrent.setDate(startCurrent.getDate() - 29);
      startCurrent.setHours(0,0,0,0);
      
      startPrev.setDate(startCurrent.getDate() - 30);
      endPrev.setDate(startCurrent.getDate() - 1);
      endPrev.setHours(23,59,59,999);
    }

    let currentRevenue = 0;
    let previousRevenue = 0;
    let currentOrders = 0;
    let previousOrders = 0;
    let productCounts = {};
    const trendData = [];

    for (let i = trendDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      trendData.push({
        dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sales: 0,
        itemsSold: 0
      });
    }

    allOrders.forEach(order => {
      if (!order.createdAt) return;
      const date = order.createdAt.toDate();
      const orderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const amt = Number(order.totalAmount) || 0;

      const diffTime = today.getTime() - orderDay.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      let itemsCount = 0;
      if (order.items) {
        order.items.forEach(it => { itemsCount += (Number(it.quantity) || 1); });
      }

      if (diffDays >= 0 && diffDays < trendDays) {
        const idx = trendDays - 1 - diffDays;
        if (trendData[idx]) {
          trendData[idx].sales += amt;
          trendData[idx].itemsSold += itemsCount;
        }
      }

      if (date >= startCurrent && date <= endCurrent) {
        currentRevenue += amt;
        currentOrders++;
        
        if (order.items) {
          order.items.forEach(item => {
            if (!productCounts[item.name]) {
              productCounts[item.name] = { sales: 0, revenue: 0 };
            }
            const itemQty = Number(item.quantity) || 1;
            const itemPrice = Number(item.price) || 0;
            productCounts[item.name].sales += itemQty;
            productCounts[item.name].revenue += (itemPrice * itemQty);
          });
        }
      } else if (date >= startPrev && date <= endPrev) {
        previousRevenue += amt;
        previousOrders++;
      }
    });

    const currentAvg = currentOrders > 0 ? (currentRevenue / currentOrders) : 0;
    const previousAvg = previousOrders > 0 ? (previousRevenue / previousOrders) : 0;
    
    const sortedProducts = Object.entries(productCounts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.sales - a.sales);

    const topProduct = sortedProducts.length > 0 ? sortedProducts[0] : null;

    setStats(prev => ({
      ...prev,
      currentRevenue,
      previousRevenue,
      currentOrders,
      previousOrders,
      currentAvg,
      previousAvg,
      topProduct: topProduct ? topProduct.name : 'N/A',
      topProductSales: topProduct ? topProduct.sales : 0,
      bestSelling: sortedProducts.slice(0, 5),
      leastSelling: sortedProducts.slice(-5).reverse(), // Bottom 5
      salesTrend: trendData
    }));
  }, [allOrders, trendDays, loading, globalDateRange, globalCustomStart, globalCustomEnd]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20 text-zinc-400">
        <div className="animate-spin text-3xl mb-2 mr-3 inline-block">⏳</div>
        <p>Crunching the numbers...</p>
      </div>
    );
  }

  const revenueVariance = stats.previousRevenue === 0 ? (stats.currentRevenue > 0 ? 100 : 0) : ((stats.currentRevenue - stats.previousRevenue) / stats.previousRevenue) * 100;
  const revenueDiffText = stats.previousRevenue === 0 ? "No prior data" : `${revenueVariance > 0 ? '+' : ''}${revenueVariance.toFixed(1)}% vs prior`;

  const generateTrendPath = () => {
    const trend = stats.salesTrend || [];
    if (trend.length === 0) return { path: '', points: [], maxSales: 1 };
    if (trend.length === 1) {
      const maxSales = Math.max(trend[0].sales, 1);
      const pt = { x: 200, y: 90 - ((trend[0].sales / maxSales) * 80) };
      return { path: `M ${pt.x},${pt.y} L ${pt.x},${pt.y}`, points: [pt], maxSales };
    }

    const maxSales = Math.max(...trend.map(t => t.sales), 1);
    const points = trend.map((val, i) => ({
      x: (i / Math.max(1, trend.length - 1)) * 400,
      y: 90 - ((val.sales / maxSales) * 80)
    }));

    let path = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const c = points[i];
      const midX = (p.x + c.x) / 2;
      path += ` C ${midX},${p.y} ${midX},${c.y} ${c.x},${c.y}`;
    }
    return { path, points, maxSales };
  };

  const trendDataObj = generateTrendPath();

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title={`${globalDateRange === 'Today' ? "Today's" : "Period"} Revenue`} value={`₱${stats.currentRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} subtext={revenueDiffText} icon="" />
        <StatCard title="Total Orders" value={stats.currentOrders} subtext="Orders in period" icon="" />
        <StatCard title="Avg. Order Value" value={`₱${stats.currentAvg.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} subtext="Average in period" icon="" />
        <StatCard title="Top Product" value={stats.topProduct} subtext={`${stats.topProductSales} units sold`} icon="" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 content-card h-[350px]">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="font-bold text-sm mb-1">Sales Trend ({globalDateRange})</h3>
              <p className="text-[10px] text-zinc-400">Order velocity & timeline</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Global Sync Active</span>
            </div>
          </div>

          <div className="w-full h-40 mt-6 border-b border-zinc-100 relative">
            <svg viewBox="0 -50 400 150" className="w-full h-full overflow-visible" onMouseLeave={() => setHoveredPoint(null)}>
              <path d={trendDataObj.path} fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-in fade-in zoom-in-95 duration-500" />

              {trendDataObj.points.map((pt, i) => (
                <g key={i} className="cursor-pointer outline-none" onMouseEnter={() => setHoveredPoint(i)} onTouchStart={() => setHoveredPoint(i)}>
                  <circle cx={pt.x} cy={pt.y} r="16" fill="transparent" />
                  <circle cx={pt.x} cy={pt.y} r={hoveredPoint === i ? 4.5 : 0} fill={hoveredPoint === i ? "black" : "transparent"} stroke={hoveredPoint === i ? "white" : "transparent"} strokeWidth="1.5" className="transition-all duration-200" />

                  {hoveredPoint === i && stats.salesTrend[i] && (
                    <g className="animate-in slide-in-from-bottom-1 fade-in duration-100 relative z-50">
                      <rect x={pt.x - 50} y={pt.y - 65} width="100" height="52" fill="#18181b" rx="6" />
                      <polygon points={`${pt.x - 5},${pt.y - 14} ${pt.x + 5},${pt.y - 14} ${pt.x},${pt.y - 9}`} fill="#18181b" />
                      <text x={pt.x} y={pt.y - 48} fill="#a1a1aa" fontSize="9" fontWeight="bold" textAnchor="middle">{stats.salesTrend[i].dateLabel}</text>
                      <text x={pt.x} y={pt.y - 32} fill="white" fontSize="13" fontWeight="bold" textAnchor="middle">₱{stats.salesTrend[i].sales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</text>
                      <text x={pt.x} y={pt.y - 20} fill="#a1a1aa" fontSize="9" textAnchor="middle">{stats.salesTrend[i].itemsSold} items sold</text>
                    </g>
                  )}
                </g>
              ))}
            </svg>
          </div>

          <div className="flex justify-between items-center text-[10px] text-zinc-400 mt-3 font-medium px-1">
            <span>{stats.salesTrend.length > 0 ? stats.salesTrend[0].dateLabel : ''}</span>
            <span>{stats.salesTrend.length > 2 ? stats.salesTrend[Math.floor(stats.salesTrend.length / 2)].dateLabel : ''}</span>
            <span>{stats.salesTrend.length > 1 ? stats.salesTrend[stats.salesTrend.length - 1].dateLabel : 'Today'}</span>
          </div>
        </div>

        <div className="content-card flex flex-col">
          <h3 className="font-bold text-sm mb-4 flex justify-between">
            Low Stock Alerts
            <span className="text-[10px] text-zinc-400 font-normal">{stats.lowStock.length} items</span>
          </h3>
          <div className="space-y-3">
            {stats.lowStock.length > 0 ? stats.lowStock.map(item => (
              <div key={item.id} className="stock-item border-b border-zinc-50 pb-2 last:border-0 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="font-bold text-sm">{item.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${item.status === 'Critical' ? 'text-rose-500' : 'text-amber-500'}`}>{item.status}</span>
                </div>
                <button className="text-zinc-400 hover:text-black font-bold text-[10px] transition-colors">RESTOCK</button>
              </div>
            )) : (
              <p className="text-sm text-zinc-400 py-4 text-center">All inventory stock levels are healthy!</p>
            )}
          </div>
        </div>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
        <div className="table-container mt-0">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="table-head-cell">Best-Selling Items</th>
                <th className="table-head-cell text-center">Units</th>
                <th className="table-head-cell text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {stats.bestSelling.map((p) => (
                <tr key={p.name} className="table-row">
                  <td className="table-data-cell font-bold truncate max-w-[150px]">{p.name}</td>
                  <td className="table-data-cell text-center text-emerald-600 font-bold">{p.sales}</td>
                  <td className="table-data-cell text-right font-bold">₱{p.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {stats.bestSelling.length === 0 && (
                <tr className="table-row">
                  <td colSpan="3" className="table-data-cell text-center text-zinc-400 py-8">No data available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-container mt-0">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="table-head-cell">Least-Selling Items</th>
                <th className="table-head-cell text-center">Units</th>
                <th className="table-head-cell text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {stats.leastSelling.map((p) => (
                <tr key={p.name} className="table-row">
                  <td className="table-data-cell font-bold truncate max-w-[150px]">{p.name}</td>
                  <td className="table-data-cell text-center text-rose-500 font-bold">{p.sales}</td>
                  <td className="table-data-cell text-right font-bold">₱{p.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {stats.leastSelling.length === 0 && (
                <tr className="table-row">
                  <td colSpan="3" className="table-data-cell text-center text-zinc-400 py-8">No data available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Global Date State initialized with 'Weekly'
  const [globalDateRange, setGlobalDateRange] = useState('Weekly');
  const [globalCustomStart, setGlobalCustomStart] = useState('');
  const [globalCustomEnd, setGlobalCustomEnd] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            setUser({ uid: firebaseUser.uid, email: firebaseUser.email, ...userDocSnap.data() });
          } else {
            auth.signOut();
            setUser(null);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.uid) return undefined;

    let sessionId = '';
    let beat = null;
    const begin = async () => {
      try {
        sessionId = await startUserSession(user);
        await logUserAction(user, 'LOGIN', { subsystem: 'SRD' });
        beat = setInterval(() => {
          heartbeatSession(sessionId).catch((err) => console.error('Heartbeat failed:', err));
        }, 45000);
      } catch (err) {
        console.error('Session start failed:', err);
      }
    };

    begin();

    return () => {
      if (beat) clearInterval(beat);
      if (sessionId) {
        endUserSession(sessionId).catch((err) => console.error('End session failed:', err));
        logUserAction(user, 'LOGOUT', { subsystem: 'SRD' }).catch((err) => console.error('Logout log failed:', err));
      }
    };
  }, [user]);


  if (isAuthLoading) {
    return <div className="min-h-screen bg-zinc-50 flex flex-col justify-center items-center font-sans"><div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg animate-pulse">C</div><p className="mt-4 text-sm text-zinc-500 font-medium">Loading Dashboard...</p></div>;
  }

  if (!user) {
    return <LoginPage onLogin={(userData) => setUser(userData)} />;
  }


  const navItems = [
    { name: 'Overview', icon: '' },
    { name: 'Sales Analytics', icon: '' },
    { name: 'Sales Forecasting', icon: '' },
    { name: 'Sales Reports', icon: '' },
    { name: 'Inventory Alerts', icon: '' },
    ...(isAdminRole(user.role) ? [
      { name: 'User Management', icon: '' },
      { name: 'Activity Logs', icon: '' }
    ] : [])
  ];

  return (
    <div className="dashboard-container">
      <AppSidebar user={user} navItems={navItems} activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="main-content">
        <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-8">
          <h2 className="text-xl font-bold tracking-tight">{activeTab}</h2>
          <div className="flex flex-wrap items-center gap-4 w-full xl:w-auto">
            {activeTab !== 'User Management' && activeTab !== 'Inventory Alerts' && (
              <GlobalDateFilter
                globalDateRange={globalDateRange} setGlobalDateRange={setGlobalDateRange}
                globalCustomStart={globalCustomStart} setGlobalCustomStart={setGlobalCustomStart}
                globalCustomEnd={globalCustomEnd} setGlobalCustomEnd={setGlobalCustomEnd}
              />
            )}
            <input type="text" placeholder="Search reports..." className="search-input" />
          </div>
        </header>


        {activeTab === 'Sales Analytics' ? (
          <SalesAnalytics globalDateRange={globalDateRange} globalCustomStart={globalCustomStart} globalCustomEnd={globalCustomEnd} />
        ) : activeTab === 'Sales Forecasting' ? (
          <SalesForecasting globalDateRange={globalDateRange} globalCustomStart={globalCustomStart} globalCustomEnd={globalCustomEnd} />
        ) : activeTab === 'Sales Reports' ? (
          <SalesReport
            globalDateRange={globalDateRange}
            globalCustomStart={globalCustomStart}
            globalCustomEnd={globalCustomEnd}
            currentUser={user}
          />
        ) : activeTab === 'Inventory Alerts' ? (
          <InventoryAlerts />
        ) : activeTab === 'User Management' && isAdminRole(user.role) ? (
          <UserManagement currentUser={user} />
        ) : activeTab === 'Activity Logs' && isAdminRole(user.role) ? (
          <ActivityLogs currentUser={user} />
        ) : (
          <Overview globalDateRange={globalDateRange} globalCustomStart={globalCustomStart} globalCustomEnd={globalCustomEnd} />
        )}
      </main>
    </div>
  );
}

export default App;