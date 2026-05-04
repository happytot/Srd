import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { Loader2, Download } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import ExportEngine from './utils/ExportEngine';

// ==================== SAFE FORMATTER FUNCTION ====================
const formatYAxis = (v) => {
  if (v >= 1000) {
    return `₱${(v / 1000).toFixed(0)}k`;
  }
  return `₱${v}`;
};

const SalesForecasting = () => {
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [forecastDays, setForecastDays] = useState(14);
  const [scenarioGrowth, setScenarioGrowth] = useState(0);
  const [confidenceMargin, setConfidenceMargin] = useState(5);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map((doc) => {
        const order = doc.data();
        return {
          id: doc.id,
          timestamp: order.createdAt ? order.createdAt.toDate() : new Date(0),
          amount: Number(order.totalAmount) || 0,
        };
      });

      setReportData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load sales data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const forecastData = useMemo(() => {
    if (reportData.length === 0) return { data: [], metrics: null };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const dailyAgg = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dailyAgg[d.getTime()] = 0;
    }

    reportData.forEach((order) => {
      const d = new Date(order.timestamp.getFullYear(), order.timestamp.getMonth(), order.timestamp.getDate());
      const t = d.getTime();
      if (dailyAgg[t] !== undefined) dailyAgg[t] += order.amount;
    });

    const historicalArray = Object.keys(dailyAgg)
      .sort((a, b) => Number(a) - Number(b))
      .map((key, idx) => ({
        dateLabel: new Date(Number(key)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sales: dailyAgg[key],
        dayIndex: idx + 1,
      }));

    const n = historicalArray.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    historicalArray.forEach((pt) => {
      sumX += pt.dayIndex;
      sumY += pt.sales;
      sumXY += pt.dayIndex * pt.sales;
      sumXX += pt.dayIndex * pt.dayIndex;
    });

    const slope = n * sumXX - sumX * sumX === 0 ? 0 : (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const combinedData = [];

    historicalArray.forEach((pt, idx) => {
      const isLast = idx === historicalArray.length - 1;
      combinedData.push({
        dateLabel: pt.dateLabel,
        actual: pt.sales,
        projected: isLast ? pt.sales : null,
        lower: null,
        upper: null,
      });
    });

    let accumulatedForecast = 0;

    for (let i = 1; i <= forecastDays; i++) {
      const futureX = n + i;
      let projectedValue = Math.max((slope * futureX) + intercept, 0);
      projectedValue *= (1 + scenarioGrowth / 100);

      const d = new Date(today);
      d.setDate(today.getDate() + i);

      const errorMargin = (confidenceMargin / 100) * projectedValue * (1 + i * 0.05);

      combinedData.push({
        dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actual: null,
        projected: projectedValue,
        lower: Math.max(0, projectedValue - errorMargin),
        upper: projectedValue + errorMargin,
      });

      accumulatedForecast += projectedValue;
    }

    const avgActualWeekly = (sumY / 30) * 7;
    const avgForecastWeekly = (accumulatedForecast / forecastDays) * 7;

    return {
      data: combinedData,
      metrics: {
        historicalAvg: avgActualWeekly,
        forecastAvg: avgForecastWeekly,
        growth: avgActualWeekly > 0 ? ((avgForecastWeekly - avgActualWeekly) / avgActualWeekly) * 100 : 0,
      },
    };
  }, [reportData, forecastDays, scenarioGrowth, confidenceMargin]);

  const resetScenarios = () => {
    setScenarioGrowth(0);
    setConfidenceMargin(5);
    setForecastDays(14);
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;

    const actual = payload.find((p) => p.dataKey === 'actual');
    const projected = payload.find((p) => p.dataKey === 'projected');

    return (
      <div className="bg-black text-white p-3 rounded-lg text-xs shadow-xl">
        <p className="font-bold mb-2 border-b border-zinc-700 pb-1">{label}</p>
        {actual?.value !== null && (
          <div className="flex justify-between gap-4">
            <span className="text-zinc-400">Actual</span>
            <span className="font-bold">₱{actual.value.toLocaleString()}</span>
          </div>
        )}
        {projected?.value !== null && (
          <div className="flex justify-between gap-4">
            <span className="text-blue-400">Projected</span>
            <span className="font-bold text-blue-400">₱{projected.value.toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="content-card flex justify-center items-center py-20 text-zinc-400">
        <Loader2 className="animate-spin mb-2 mr-3 inline-block" size={32} />
        <p>Running forecasting model...</p>
      </div>
    );
  }

  if (error) return <div className="content-card p-8 text-rose-600 text-center">{error}</div>;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-xl border border-zinc-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold">Predictive Sales Forecasting</h2>
          <p className="text-xs text-zinc-400">Based on real historical data</p>
        </div>

        <select
          value={forecastDays}
          onChange={(e) => setForecastDays(Number(e.target.value))}
          className="search-input !w-full md:!w-auto !bg-white border border-zinc-200"
        >
          <option value={7}>7-Day Forecast</option>
          <option value={14}>14-Day Forecast</option>
          <option value={30}>30-Day Forecast</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="content-card">
          <p className="text-xs font-bold text-zinc-400 uppercase">Projected Status</p>
          <div className="flex items-center gap-3 mt-2">
            <div className={`w-3 h-3 rounded-full animate-pulse ${forecastData.metrics.growth >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <p className="text-xl font-black">
              {forecastData.metrics.growth >= 0 ? 'Trending Up' : 'Trending Down'}
            </p>
          </div>
        </div>

        <div className="content-card">
          <p className="text-xs font-bold text-zinc-400 uppercase">Avg Historical (Weekly)</p>
          <p className="text-2xl font-black">₱{forecastData.metrics.historicalAvg.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>

        <div className="content-card border-blue-100 bg-blue-50/30">
          <p className="text-xs font-bold text-blue-500 uppercase">Projected Revenue (Weekly)</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-black text-blue-600">
              ₱{forecastData.metrics.forecastAvg.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <span className={`text-sm font-bold ${forecastData.metrics.growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {forecastData.metrics.growth >= 0 ? '+' : ''}{forecastData.metrics.growth.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 content-card h-[480px]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="font-bold text-lg">Sales Trend + Forecast</h3>
              <p className="text-xs text-zinc-400">Last 30 days + {forecastDays} days projection</p>
            </div>
            <button
              onClick={() => ExportEngine.exportToImage('forecast-chart', 'Sales_Forecast')}
              className="px-3 py-1 text-xs font-bold text-zinc-500 hover:bg-zinc-100 rounded-lg transition-colors flex items-center justify-center"
            >
              <Download size={14} className="mr-1.5" /> Export
            </button>
          </div>

          <ResponsiveContainer width="100%" height="85%">
            <ComposedChart data={forecastData.data} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f1f1" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fontSize: 11 }}
              />
              <RechartsTooltip content={<CustomTooltip />} />
              <Legend />

              <Area type="monotone" dataKey="lower" stroke="none" fill="#dbeafe" fillOpacity={0.4} />
              <Area type="monotone" dataKey="upper" stroke="none" fill="#dbeafe" fillOpacity={0.4} />

              <Line type="monotone" dataKey="actual" stroke="#09090b" strokeWidth={3} dot={false} activeDot={{ r: 5 }} name="Actual" />
              <Line type="monotone" dataKey="projected" stroke="#3b82f6" strokeWidth={3} strokeDasharray="6 3" dot={false} activeDot={{ r: 5 }} name="Projected" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="content-card flex flex-col bg-zinc-50 border border-zinc-200">
          <h3 className="font-bold text-sm mb-1">Scenario Testing</h3>
          <p className="text-[10px] text-zinc-500 mb-6">Simulate what-if events</p>

          <div className="space-y-8 flex-1">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-bold text-zinc-700">Market Growth</label>
                <span className={`text-xs font-bold ${scenarioGrowth >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {scenarioGrowth >= 0 ? '+' : ''}{scenarioGrowth}%
                </span>
              </div>
              <input
                type="range"
                min="-50"
                max="50"
                step="5"
                value={scenarioGrowth}
                onChange={(e) => setScenarioGrowth(Number(e.target.value))}
                className="w-full accent-black"
              />
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-bold text-zinc-700">Confidence Margin ±</label>
                <span className="text-xs font-bold text-blue-500">{confidenceMargin}%</span>
              </div>
              <input
                type="range"
                min="1"
                max="25"
                step="1"
                value={confidenceMargin}
                onChange={(e) => setConfidenceMargin(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>

          <button
            onClick={resetScenarios}
            className="w-full mt-6 py-3 text-xs font-bold bg-zinc-100 hover:bg-zinc-200 transition-colors rounded-xl"
          >
            Reset Scenarios
          </button>
        </div>
      </div>
    </div>
  );
};

export default SalesForecasting;