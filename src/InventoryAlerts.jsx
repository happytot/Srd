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

  // 1. Fetch Sales Velocity (last 30 days)
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

      const dailyRateMap = {};
      Object.keys(velocityMap).forEach(key => {
        dailyRateMap[key] = Number((velocityMap[key] / 30).toFixed(2));
      });

      setItemVelocity(dailyRateMap);
    });

    return () => unsubOrders();
  }, []);

  // 2. Fetch Inventory
  useEffect(() => {
    const inventoryQuery = query(collection(db, 'inventory'), where('status', '!=', 'deleted'));

    const unsubInventory = onSnapshot(inventoryQuery, (snapshot) => {
      const data = [];
      snapshot.forEach(docSnap => {
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

  // 3. Merge & Compute Supply Chain Metrics
  const inventoryData = useMemo(() => {
    const mergedData = rawInventory.map(inv => {
      const qty = Number(inv.quantity) || 0;
      const threshold = Number(inv.lowStockThreshold) || Math.max(10, qty * 0.1);

      const leadTime = Number(inv.leadTimeDays) || 7;
      const safetyStock = Number(inv.safetyStock) || 15;

      const dailyConsumptionRate = itemVelocity[inv.name] || 0;
      const reorderPoint = (leadTime * dailyConsumptionRate) + safetyStock;

      const daysUntilReorder = dailyConsumptionRate > 0
        ? Math.floor((qty - reorderPoint) / dailyConsumptionRate)
        : 999;

      const projectedReorderDate = new Date();
      if (daysUntilReorder !== 999) {
        projectedReorderDate.setDate(projectedReorderDate.getDate() + daysUntilReorder);
      }

      const isPastReorderDate = daysUntilReorder <= 0 && dailyConsumptionRate > 0;

      let alertStatus = 'Normal';
      if (qty <= threshold * 0.3) alertStatus = 'Critical';
      else if (qty <= threshold || inv.isLowStock) alertStatus = 'Low';

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
        projectedReorderDate: daysUntilReorder === 999 ? 'Sufficient Runway' : projectedReorderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        isPastReorderDate
      };
    });

    // Sorting logic
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

  const toBuyList = useMemo(() => {
    return inventoryData
      .filter((item) => item.status === 'Critical' || item.isPastReorderDate)
      .sort((a, b) => {
        if (a.status === 'Critical' && b.status !== 'Critical') return -1;
        if (a.status !== 'Critical' && b.status === 'Critical') return 1;
        return a.daysUntilReorder - b.daysUntilReorder;
      });
  }, [inventoryData]);

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

      {/* View Toggle */}
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

      {/* Summary Cards */}
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
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f ? 'bg-black text-white shadow-sm' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Most Used Items */}
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

      {/* Main Inventory Table */}
      <div className="table-container mt-0">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/60 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-zinc-800">Inventory Alert List</p>
            <p className="text-[10px] text-zinc-500">Color legend: <span className="font-semibold text-rose-600">Red = Critical</span>, <span className="font-semibold text-amber-600">Yellow = Low</span>, <span className="font-semibold text-zinc-500">Gray = Normal</span></p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{filteredData.length} items</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell">Item</th>
                <th className="table-head-cell">Category</th>
                <th className="table-head-cell text-center">Stock</th>
                <th className="table-head-cell text-center">Threshold</th>
                <th className="table-head-cell">Status</th>
                <th className="table-head-cell">Supplier</th>
                <th className="table-head-cell">Last Restock</th>
                {viewMode === 'Forecasting' && (
                  <>
                    <th className="table-head-cell text-center">Velocity</th>
                    <th className="table-head-cell text-center">Reorder Point</th>
                    <th className="table-head-cell">Projected Reorder Date</th>
                    <th className="table-head-cell">Forecast Settings</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredData.map((item) => (
                <tr key={item.id} className={`table-row ${item.status === 'Critical' ? 'bg-rose-50/30' : item.status === 'Low' ? 'bg-amber-50/20' : ''}`}>
                  <td className="table-data-cell font-bold text-zinc-900">{item.item}</td>
                  <td className="table-data-cell text-zinc-600">{item.category}</td>
                  <td className="table-data-cell text-center font-bold">{item.stock}</td>
                  <td className="table-data-cell text-center text-zinc-500">{item.threshold}</td>
                  <td className="table-data-cell">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${viewMode === 'Forecasting' && item.isPastReorderDate ? 'text-violet-600 bg-violet-50 border-violet-200' : getStatusColor(item.status)}`}>
                      {viewMode === 'Forecasting' && item.isPastReorderDate ? 'REORDER NOW' : item.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="table-data-cell text-zinc-600">{item.supplier}</td>
                  <td className="table-data-cell text-zinc-500">{item.lastRestock}</td>
                  {viewMode === 'Forecasting' && (
                    <>
                      <td className="table-data-cell text-center font-medium text-zinc-700">{item.dailyConsumptionRate}/day</td>
                      <td className="table-data-cell text-center font-medium text-zinc-700">{item.reorderPoint}</td>
                      <td className="table-data-cell">
                        <span className={item.isPastReorderDate ? 'font-bold text-violet-700' : 'text-zinc-600'}>
                          {item.isPastReorderDate ? 'Immediate' : item.projectedReorderDate}
                        </span>
                      </td>
                      <td className="table-data-cell">
                        {editingItem === item.id ? (
                          <div className="space-y-2 min-w-[220px]">
                            <div className="grid grid-cols-2 gap-2">
                              <input type="number" className="w-full p-1.5 border border-zinc-200 rounded text-xs" value={forecastVars.leadTime} onChange={(e) => setForecastVars({ ...forecastVars, leadTime: Number(e.target.value) })} placeholder="Lead time" />
                              <input type="number" className="w-full p-1.5 border border-zinc-200 rounded text-xs" value={forecastVars.safetyStock} onChange={(e) => setForecastVars({ ...forecastVars, safetyStock: Number(e.target.value) })} placeholder="Safety stock" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleUpdateForecast(item.id)} className="flex-1 bg-black text-white text-[10px] font-bold py-1.5 rounded hover:bg-zinc-800 transition-colors">Save</button>
                              <button onClick={() => setEditingItem(null)} className="flex-1 bg-zinc-200 text-zinc-700 text-[10px] font-bold py-1.5 rounded hover:bg-zinc-300 transition-colors">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingItem(item.id); setForecastVars({ leadTime: item.leadTime, safetyStock: item.safetyStock }); }} className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded border border-orange-100 hover:bg-orange-100 transition-colors">
                            Edit Lead/Safety
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}

              {loading ? (
                <tr>
                  <td colSpan={viewMode === 'Forecasting' ? 11 : 7} className="py-12 text-center text-zinc-400">
                    <div className="animate-spin text-3xl mb-2 inline-block">⏳</div>
                    <p>Crunching supply chain data...</p>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={viewMode === 'Forecasting' ? 11 : 7} className="py-12 text-center text-zinc-400">
                    <div className="text-3xl mb-2">📦</div>
                    <p>No inventory items found for the selected filter.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Automated To-Buy List */}
      <div className="table-container mt-0">
        <div className="px-6 py-4 border-b border-zinc-100 bg-rose-50/60 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-rose-700">Automated To-Buy List</p>
            <p className="text-[10px] text-rose-600">Generated from Critical (red) and reorder-now items.</p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">{toBuyList.length} priority items</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="table-head-cell">Priority</th>
                <th className="table-head-cell">Item</th>
                <th className="table-head-cell">Status</th>
                <th className="table-head-cell text-center">Current Stock</th>
                <th className="table-head-cell text-center">Suggested Qty</th>
                <th className="table-head-cell">Supplier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {toBuyList.map((item) => {
                const suggestedQty = Math.max(0, Math.ceil(item.reorderPoint - item.stock));
                const priority = item.status === 'Critical' ? 'HIGH' : 'MEDIUM';
                return (
                  <tr key={`${item.id}-buy`} className="table-row">
                    <td className="table-data-cell">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${priority === 'HIGH' ? 'text-rose-600 bg-rose-50 border-rose-200' : 'text-violet-600 bg-violet-50 border-violet-200'}`}>
                        {priority}
                      </span>
                    </td>
                    <td className="table-data-cell font-bold text-zinc-900">{item.item}</td>
                    <td className="table-data-cell">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(item.status)}`}>
                        {item.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="table-data-cell text-center font-bold">{item.stock}</td>
                    <td className="table-data-cell text-center font-bold text-zinc-800">{suggestedQty}</td>
                    <td className="table-data-cell text-zinc-600">{item.supplier}</td>
                  </tr>
                );
              })}
              {toBuyList.length === 0 && !loading ? (
                <tr>
                  <td colSpan="6" className="py-10 text-center text-zinc-400">
                    All good for now. No critical or reorder-now items.
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

export default InventoryAlerts;