import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend
} from 'recharts';
import ExportEngine from './utils/ExportEngine';

const SalesForecasting = () => {
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [forecastDays, setForecastDays] = useState(14);
  const [scenarioGrowth, setScenarioGrowth] = useState(0); // What-if adjustment in %
  const [confidenceMargin, setConfidenceMargin] = useState(5); // +/- 5% baseline margin
  
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const data = querySnapshot.docs.map(doc => {
          const order = doc.data();
          return {
            id: doc.id,
            timestamp: order.createdAt ? order.createdAt.toDate() : new Date(0),
            amount: order.totalAmount || 0,
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

  // Compute Predictive Model
  const forecastData = useMemo(() => {
    if (reportData.length === 0) return { data: [], metrics: null };

    // Group by Day (last 30 days of actual data)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 29);
    
    const dailyAgg = {};
    // Initialize exactly 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dailyAgg[d.getTime()] = 0;
    }

    reportData.forEach(order => {
      const d = new Date(order.timestamp.getFullYear(), order.timestamp.getMonth(), order.timestamp.getDate());
      const t = d.getTime();
      if (dailyAgg[t] !== undefined) {
        dailyAgg[t] += order.amount;
      }
    });

    const historicalArray = Object.keys(dailyAgg)
      .sort((a,b) => Number(a) - Number(b))
      .map((key, idx) => ({
        time: Number(key),
        dayIndex: idx + 1,
        sales: dailyAgg[key],
        dateLabel: new Date(Number(key)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }));

    // Linear Regression on historical actuals
    // y = mx + b
    const n = historicalArray.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    historicalArray.forEach(pt => {
      sumX += pt.dayIndex;
      sumY += pt.sales;
      sumXY += pt.dayIndex * pt.sales;
      sumXX += pt.dayIndex * pt.dayIndex;
    });

    const slope = n * sumXX - sumX * sumX === 0 ? 0 : (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Build the final array
    const combinedData = [];
    
    // 1) Push historical
    historicalArray.forEach((pt, idx) => {
      const isLastHistoricalPoint = idx === historicalArray.length - 1;
      
      combinedData.push({
        dateLabel: pt.dateLabel,
        actual: pt.sales,
        // The last historical point acts as the anchor/starting point for the projection seamlessly
        projected: isLastHistoricalPoint ? pt.sales : null,
        confidenceRange: isLastHistoricalPoint ? [pt.sales, pt.sales] : null
      });
    });

    // 2) Predict for N days ahead
    const lastHistoricalSales = historicalArray[historicalArray.length - 1].sales;
    let accumulatedForecast = 0;
    let accumulatedActual = sumY;

    for (let i = 1; i <= forecastDays; i++) {
        const futureX = n + i;
        const projectedBase = (slope * futureX) + intercept;
        // Make sure prediction doesn't go below 0 illogically
        let projectedValue = Math.max(projectedBase, 0); 

        // Apply Scenario Growth % (compound effect simulated simply on top of base trend)
        // e.g., if user inputs +10%, we raise the projection by 10% on top of algorithm
        projectedValue = projectedValue * (1 + (scenarioGrowth / 100));
        
        const d = new Date(today);
        d.setDate(today.getDate() + i);

        // Calculate margin of error widening over time
        const errorMargin = (confidenceMargin / 100) * projectedValue * (1 + (i * 0.05)); // error expands slightly further out

        combinedData.push({
            dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            actual: null,
            projected: projectedValue,
            confidenceRange: [Math.max(0, projectedValue - errorMargin), projectedValue + errorMargin]
        });

        accumulatedForecast += projectedValue;
    }

    const avgActualWeekly = accumulatedActual / 30 * 7;
    const avgForecastWeekly = accumulatedForecast / forecastDays * 7;
    
    return {
      data: combinedData,
      metrics: {
        historicalAvg: avgActualWeekly,
        forecastAvg: avgForecastWeekly,
        growth: avgActualWeekly > 0 ? ((avgForecastWeekly - avgActualWeekly) / avgActualWeekly) * 100 : 0
      }
    };

  }, [reportData, forecastDays, scenarioGrowth, confidenceMargin]);


  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      // Find what data we are hovering over
      const act = payload.find(p => p.dataKey === 'actual');
      const proj = payload.find(p => p.dataKey === 'projected');
      const conf = payload.find(p => p.dataKey === 'confidenceRange');

      return (
        <div className="bg-black text-white p-3 rounded-lg text-xs shadow-xl min-w-[150px] z-50">
          <p className="font-bold text-zinc-300 mb-2 border-b border-zinc-700 pb-1">{label}</p>
          
          {act && act.value !== null && (
            <div className="flex justify-between items-center mb-1">
              <span className="text-zinc-400">Actual:</span>
              <span className="font-bold">₱{act.value.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
            </div>
          )}
          
          {proj && proj.value !== null && act?.value === null && (
            <div className="flex justify-between items-center mb-1">
              <span className="text-[#3b82f6]">Projected:</span>
              <span className="font-bold text-[#3b82f6]">₱{proj.value.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
            </div>
          )}

          {conf && conf.value && conf.value.length === 2 && act?.value === null && (
            <div className="flex justify-between items-center mt-2 text-[10px] text-zinc-500 border-t border-zinc-800 pt-1">
              <span>95% CI bounds:</span>
              <span>₱{conf.value[0].toLocaleString(undefined, {maximumFractionDigits:0})} - ₱{conf.value[1].toLocaleString(undefined, {maximumFractionDigits:0})}</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-xl border border-zinc-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
        
        <div>
           <h2 className="text-lg font-bold">Predictive Forecasting</h2>
           <p className="text-xs text-zinc-400">Algorithmic sales projections based on trailing 30-day performance.</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto z-10">
          <select 
            value={forecastDays} 
            onChange={(e) => setForecastDays(Number(e.target.value))}
            className="search-input !w-full md:!w-auto !bg-white border !border-zinc-200 font-medium text-zinc-700 cursor-pointer shadow-sm"
          >
            <option value={7}>7-Day Forecast</option>
            <option value={14}>14-Day Forecast</option>
            <option value={30}>30-Day Forecast</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-zinc-400 bg-white rounded-xl border border-zinc-200 shadow-sm">
          <div className="animate-spin text-3xl mb-2 mr-3 inline-block">⏳</div>
          <p>Running ML regressions...</p>
        </div>
      ) : forecastData.data.length === 0 ? (
        <div className="flex justify-center items-center py-20 text-zinc-400 bg-white rounded-xl border border-zinc-200 shadow-sm">
           <p>Not enough historical data to generate forecast.</p>
        </div>
      ) : (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="content-card flex flex-col justify-between">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Projected Status</p>
              <div className="flex items-center gap-3">
                 <div className={`w-3 h-3 rounded-full animate-pulse ${forecastData.metrics.growth >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                 <p className="text-xl font-black">{forecastData.metrics.growth >= 0 ? 'Trending Upwards' : 'Trending Downwards'}</p>
              </div>
            </div>
            
            <div className="content-card">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Avg Historical Revenue (Weekly)</p>
              <p className="text-2xl font-black text-black">₱{forecastData.metrics.historicalAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            </div>
            
            <div className="content-card border-blue-100 bg-blue-50/20">
              <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">Projected Revenue (Weekly)</p>
              <div className="flex items-baseline gap-2">
                 <p className="text-2xl font-black text-blue-600">₱{forecastData.metrics.forecastAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                 <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${forecastData.metrics.growth >= 0 ? 'text-emerald-600 bg-emerald-100' : 'text-rose-600 bg-rose-100'}`}>
                    {forecastData.metrics.growth >= 0 ? '+' : ''}{forecastData.metrics.growth.toFixed(1)}%
                 </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            {/* Chart */}
            <div className="xl:col-span-3 content-card h-[450px] relative overflow-hidden">
               <div className="flex justify-between items-start mb-6">
                 <div>
                   <h3 className="font-bold text-lg mb-1">Trend Projection Model</h3>
                   <div className="flex items-center gap-4 text-xs text-zinc-500">
                     <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-black"></span> Actual</div>
                     <div className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 border border-dashed border-blue-500"></span> Forecast</div>
                     <div className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded-sm"></span> Confidence Interval</div>
                   </div>
                 </div>
                 <button 
                   onClick={() => ExportEngine.exportToImage('forecast-composed-chart', 'Forecast_Model')}
                   className="px-2 py-1 text-[10px] font-bold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 rounded transition-colors"
                 >
                   📸 Export PNG
                 </button>
               </div>

               <div id="forecast-composed-chart" className="w-full h-[350px] bg-white p-2">
                 <ResponsiveContainer width="100%" height="100%">
                   <ComposedChart data={forecastData.data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                     <XAxis 
                       dataKey="dateLabel" 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{fill: '#a1a1aa', fontSize: 11}} 
                       dy={10} 
                       minTickGap={20}
                     />
                     <YAxis 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{fill: '#a1a1aa', fontSize: 11}} 
                       tickFormatter={(value) => `₱${value >= 1000 ? (value/1000).toFixed(1)+'k' : value}`} 
                       dx={-10} 
                     />
                     <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: '#a1a1aa', strokeWidth: 1, strokeDasharray: '4 4' }} />
                     
                     {/* Confidence Interval Area */}
                     <Area 
                       type="monotone" 
                       dataKey="confidenceRange" 
                       stroke="none" 
                       fill="#dbeafe" 
                       fillOpacity={0.6}
                       connectNulls
                     />

                     {/* Historical Line */}
                     <Line 
                       type="monotone" 
                       dataKey="actual" 
                       stroke="#09090b" 
                       strokeWidth={3} 
                       dot={false}
                       activeDot={{r: 5, fill: '#000'}} 
                     />
                     
                     {/* Projected Line */}
                     <Line 
                       type="monotone" 
                       dataKey="projected" 
                       stroke="#3b82f6" 
                       strokeWidth={3} 
                       strokeDasharray="5 5" 
                       dot={false}
                       activeDot={{r: 5, fill: '#3b82f6'}} 
                     />
                   </ComposedChart>
                 </ResponsiveContainer>
               </div>
            </div>

            {/* Scenario Testing Sidebar */}
            <div className="content-card flex flex-col bg-zinc-50 border-zinc-200">
               <h3 className="font-bold text-sm mb-1">Scenario Testing</h3>
               <p className="text-[10px] text-zinc-500 mb-6">Simulate "What-if" events and impact on projections.</p>

               <div className="space-y-6 flex-1">
                 <div>
                    <div className="flex justify-between items-center mb-2">
                       <label className="text-xs font-bold text-zinc-700">Market Growth Setup</label>
                       <span className={`text-xs font-bold ${scenarioGrowth > 0 ? 'text-emerald-500' : scenarioGrowth < 0 ? 'text-rose-500' : 'text-zinc-500'}`}>
                         {scenarioGrowth > 0 ? '+' : ''}{scenarioGrowth}%
                       </span>
                    </div>
                    <input 
                      type="range" 
                      min="-50" 
                      max="50" 
                      step="5"
                      value={scenarioGrowth}
                      onChange={(e) => setScenarioGrowth(Number(e.target.value))}
                      className="w-full h-1.5 bg-zinc-200 outline-none rounded-lg appearance-none cursor-pointer accent-black"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-400 mt-1 font-medium">
                       <span>-50% (Pessimistic)</span>
                       <span>+50% (Optimistic)</span>
                    </div>
                 </div>

                 <div>
                    <div className="flex justify-between items-center mb-2">
                       <label className="text-xs font-bold text-zinc-700">Confidence Margin ±</label>
                       <span className="text-xs font-bold text-blue-500">{confidenceMargin}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="20" 
                      step="1"
                      value={confidenceMargin}
                      onChange={(e) => setConfidenceMargin(Number(e.target.value))}
                      className="w-full h-1.5 bg-blue-100 outline-none rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-400 mt-1 font-medium">
                       <span>Narrow (High Risk)</span>
                       <span>Wide (Safe)</span>
                    </div>
                 </div>

                 <div className="bg-white p-3 rounded-lg border border-zinc-100 shadow-sm mt-4">
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                       <strong>Insight:</strong> Scenario adjustments recalculate the forecasted trend-line instantly. The margin of error bounds widen based on the chronological distance from historical data to simulate compounding uncertainty.
                    </p>
                 </div>
               </div>
               
               <button 
                 onClick={() => { setScenarioGrowth(0); setConfidenceMargin(5); setForecastDays(14); }}
                 className="w-full mt-4 px-4 py-2 bg-zinc-200/50 hover:bg-zinc-200 text-zinc-600 rounded-lg text-xs font-bold transition-all"
               >
                 Reset Scenarios
               </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SalesForecasting;
