import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

const InventoryAlerts = () => {
  const [filter, setFilter] = useState('All Alerts');
  const [viewMode, setViewMode] = useState('Alerts');
  const [rawInventory, setRawInventory] = useState([]);
  const [itemVelocity, setItemVelocity] = useState({});
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [forecastVars, setForecastVars] = useState({ leadTime: 0, safetyStock: 0 });

  // 1. Fetch Sales Velocity from the last 30 days
  useEffect(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const ordersQuery = query(
      collection(db, 'orders'),
      where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo))
    );

    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      const velocityMap = {};

      snapshot.forEach(docSnap => {
        const order = docSnap.data();
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach(item => {
            const itemName = item.name;
            const qty = Number(item.quantity) || 1;
            velocityMap[itemName] = (velocityMap[itemName] || 0) + qty;
          });
        }
      });

      // Convert 30-day totals into a daily consumption rate
      const dailyRateMap = {};
      Object.keys(velocityMap).forEach(key => {
        dailyRateMap[key] = Number((velocityMap[key] / 30).toFixed(2));
      });

      setItemVelocity(dailyRateMap);
    });

    return () => unsubOrders();
  }, []);

  // 2. Fetch Base Inventory
  useEffect(() => {
    const inventoryQuery = query(collection(db, 'inventory'), where('status', '!=', 'deleted'));

    const unsubInventory = onSnapshot(inventoryQuery, (querySnapshot) => {
      const data = [];
      querySnapshot.forEach(docSnap => {
        data.push({ id: docSnap.id, ...docSnap.data() });
      });
      setRawInventory(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching inventory:", error);
      setLoading(false);
    });

    return () => unsubInventory();
  }, []);

  // 3. Merge & Compute Supply Chain Math
  const inventoryData = useMemo(() => {
    const mergedData = rawInventory.map(inv => {
      const qty = Number(inv.quantity) || 0;
      const threshold = Number(inv.lowStockThreshold) || Math.max(10, qty * 0.1);

      const leadTime = Number(inv.leadTimeDays) || 7;
      const safetyStock = Number(inv.safetyStock) || 15;

      // Dynamic Trailing Velocity (fallback to 0 if no sales in 30 days)
      const dailyConsumptionRate = itemVelocity[inv.name] || 0;

      const reorderPoint = (leadTime * dailyConsumptionRate) + safetyStock;

      // Prevent Infinity if DCR is 0
      const daysUntilReorder = dailyConsumptionRate > 0
        ? Math.floor((qty - reorderPoint) / dailyConsumptionRate)
        : 999;

      const projectedReorderDate = new Date();
      if (daysUntilReorder !== 999) {
        projectedReorderDate.setDate(projectedReorderDate.getDate() + daysUntilReorder);
      }

      const isPastReorderDate = daysUntilReorder <= 0 && dailyConsumptionRate > 0;

      let alertStatus = 'Normal';
      if (qty <= threshold * 0.3) {
        alertStatus = 'Critical';
      } else if (qty <= threshold || inv.isLowStock) {
        alertStatus = 'Low';
      }

      return {
        id: inv.id,
        item: inv.name || 'Unnamed Item',
        category: inv.category || 'Uncategorized',
        stock: qty,
        threshold: threshold,
        status: alertStatus,
        supplier: inv.supplier || 'Unknown Supplier',
        lastRestock: inv.updatedAt
          ? inv.updatedAt.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : 'N/A',
        leadTime,
        safetyStock,
        dailyConsumptionRate,
        reorderPoint: Number(reorderPoint.toFixed(1)),
        daysUntilReorder,
        projectedReorderDate: daysUntilReorder === 999
          ? 'Sufficient Runway'
          : projectedReorderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        isPastReorderDate
      };
    });

    return mergedData.sort((a, b) => {
      if (viewMode === 'Forecasting') return a.daysUntilReorder - b.daysUntilReorder;
      if (a.status === 'Critical' && b.status !== 'Critical') return -1;
      if (a.status !== 'Critical' && b.status === 'Critical') return 1;
      return (a.stock / Math.max(a.threshold, 1)) - (b.stock / Math.max(b.threshold, 1));
    });
  }, [rawInventory, itemVelocity, viewMode]);

  const filteredData = inventoryData.filter(item => {
    if (filter === 'All Alerts') return true;
    if (filter === 'Critical Only') return item.status === 'Critical';
    if (filter === 'Low Stock Only') return item.status === 'Low';
    if (filter === 'Reorder Now') return item.isPastReorderDate;
    return true;
  });

  const criticalCount = inventoryData.filter(i => i.status === 'Critical').length;
  const reorderCount = inventoryData.filter(i => i.isPastReorderDate).length;

  const mostUsedItems = useMemo(() => {
    return Object.entries(itemVelocity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, rate]) => ({ name, rate }));
  }, [itemVelocity]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'Critical': return 'text-rose-600 bg-rose-50 border-rose-200';
      case 'Low': return 'text-amber-600 bg-amber-50 border-amber-200';
      default: return 'text-zinc-600 bg-zinc-50 border-zinc-200';
    }
  };

  const getStockPercentage = (stock, threshold) => {
    const pct = (stock / (Math.max(threshold, 1) * 1.5)) * 100;
    return Math.min(Math.max(pct, 5), 100);
  };

  const handleUpdateForecast = async (id) => {
    try {
      const itemRef = doc(db, 'inventory', id);
      await updateDoc(itemRef, {
        leadTimeDays: forecastVars.leadTime,
        safetyStock: forecastVars.safetyStock
      });
      setEditingItem(null);
    } catch (error) {
      console.error("Error updating forecast variables:", error);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <div className="flex justify-between items-center bg-white p-2 rounded-xl border border-zinc-200 shadow-sm w-fit">
        <button
          onClick={() => setViewMode('Alerts')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'Alerts' ? 'bg-black text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
        >
          Current Status
        </button>
        <button
          onClick={() => setViewMode('Forecasting')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'Forecasting' ? 'bg-black text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
        >
          Reorder Forecasting
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="stat-card border-rose-200 bg-rose-50/30">
          <p className="stat-card-title !text-rose-500">Critical items</p>
          <p className="stat-card-value">{criticalCount}</p>
          <p className="text-xs font-medium text-rose-600 mt-2">Requires immediate action</p>
        </div>

        <div className="stat-card border-violet-200 bg-violet-50/30">
          <p className="stat-card-title !text-violet-600">Past Reorder Date</p>
          <p className="stat-card-value">{reorderCount}</p>
          <p className="text-xs font-medium text-violet-700 mt-2">Forecasted stockout risk</p>
        </div>

        <div className="stat-card md:col-span-2 flex flex-col justify-center">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-card-title">Filter Views</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {['All Alerts', 'Critical Only', 'Low Stock Only', 'Reorder Now'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f
                  ? 'bg-black text-white shadow-sm'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mostUsedItems.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-bold text-sm text-zinc-900 mt-2">Most Used Items (30-Day Velocity)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {mostUsedItems.map((item, idx) => (
              <div key={idx} className="bg-white border border-emerald-200 rounded-xl p-4 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs shrink-0">#{idx + 1}</div>
                  <div>
                    <p className="font-bold text-sm text-zinc-900 truncate max-w-[120px]" title={item.name}>{item.name}</p>
                    <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mt-0.5">Fast Moving</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-emerald-700 text-lg leading-none">{item.rate}</p>
                  <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-wider mt-1">Units / Day</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredData.map((item) => (
          <div key={item.id} className={`bg-white border text-sm rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col ${item.isPastReorderDate && viewMode === 'Forecasting' ? 'border-violet-300 ring-2 ring-violet-50' : 'border-zinc-200'}`}>

            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg text-zinc-900 leading-tight">{item.item}</h3>
                <p className="text-xs text-zinc-400 font-medium uppercase tracking-wider mt-1">{item.category}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${viewMode === 'Forecasting' && item.isPastReorderDate ? 'text-violet-600 bg-violet-50 border-violet-200' : getStatusColor(item.status)}`}>
                {viewMode === 'Forecasting' && item.isPastReorderDate ? 'REORDER NOW' : item.status.toUpperCase()}
              </span>
            </div>

            {viewMode === 'Alerts' ? (
              <div className="space-y-3 mb-6 flex-1">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-500">Current Stock</span>
                    <span className="font-bold">{item.stock} <span className="text-zinc-400 font-normal">/ {item.threshold} min</span></span>
                  </div>
                  <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${item.status === 'Critical' ? 'bg-rose-500' : 'bg-amber-500'}`}
                      style={{ width: `${getStockPercentage(item.stock, item.threshold)}%` }}
                    ></div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-zinc-50">
                  <div>
                    <p className="text-zinc-400 mb-0.5">Supplier</p>
                    <p className="font-medium text-zinc-700 truncate">{item.supplier}</p>
                  </div>
                  <div>
                    <p className="text-zinc-400 mb-0.5">Last Restock</p>
                    <p className="font-medium text-zinc-700">{item.lastRestock}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 mb-6 flex-1 bg-zinc-50/50 p-3 rounded-lg border border-zinc-100">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                  <div>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">Target Reorder Date</p>
                    <p className={`font-bold text-base ${item.isPastReorderDate ? 'text-violet-600' : 'text-zinc-900'}`}>
                      {item.isPastReorderDate ? 'Immediate' : item.projectedReorderDate}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">30-Day Velocity</p>
                    <p className="font-bold text-sm text-zinc-700">{item.dailyConsumptionRate} / day</p>
                  </div>
                </div>

                {editingItem === item.id ? (
                  <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex gap-3">
                      <label className="flex-1 text-xs font-medium text-zinc-600">
                        Lead Time (Days)
                        <input type="number" className="w-full mt-1 p-1.5 border border-zinc-200 rounded text-sm" value={forecastVars.leadTime} onChange={(e) => setForecastVars({ ...forecastVars, leadTime: Number(e.target.value) })} />
                      </label>
                      <label className="flex-1 text-xs font-medium text-zinc-600">
                        Safety Stock
                        <input type="number" className="w-full mt-1 p-1.5 border border-zinc-200 rounded text-sm" value={forecastVars.safetyStock} onChange={(e) => setForecastVars({ ...forecastVars, safetyStock: Number(e.target.value) })} />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleUpdateForecast(item.id)} className="flex-1 bg-black text-white text-xs font-bold py-1.5 rounded hover:bg-zinc-800 transition-colors">Save Data</button>
                      <button onClick={() => setEditingItem(null)} className="flex-1 bg-zinc-200 text-zinc-700 text-xs font-bold py-1.5 rounded hover:bg-zinc-300 transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-end group cursor-pointer" onClick={() => { setEditingItem(item.id); setForecastVars({ leadTime: item.leadTime, safetyStock: item.safetyStock }); }}>
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-500">Lead Time: <span className="font-medium text-zinc-900">{item.leadTime} days</span></p>
                      <p className="text-xs text-zinc-500">Safety Stock: <span className="font-medium text-zinc-900">{item.safetyStock} units</span></p>
                      <p className="text-xs text-zinc-500 pt-1">Reorder Point: <span className="font-medium text-zinc-900">{item.reorderPoint} units</span></p>
                    </div>
                    <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">EDIT PARAMS</span>
                  </div>
                )}
              </div>
            )}

            <button className={`w-full py-2.5 rounded-lg text-sm font-bold shadow-sm transition-all active:scale-[0.98] flex justify-center items-center gap-2 ${item.isPastReorderDate && viewMode === 'Forecasting' ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-zinc-900 text-white hover:bg-black'}`}>
              Generate Purchase Order
            </button>
          </div>
        ))}

        {loading && (
          <div className="col-span-full py-12 text-center text-zinc-400 bg-white rounded-xl border border-zinc-200 border-dashed">
            <div className="animate-spin text-3xl mb-2 inline-block">⏳</div>
            <p className="font-medium">Crunching supply chain data...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryAlerts;