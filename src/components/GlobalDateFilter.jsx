import React, { useState } from 'react';

const GlobalDateFilter = ({ 
  globalDateRange, setGlobalDateRange, 
  globalCustomStart, setGlobalCustomStart, 
  globalCustomEnd, setGlobalCustomEnd 
}) => {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [tempStart, setTempStart] = useState(globalCustomStart);
  const [tempEnd, setTempEnd] = useState(globalCustomEnd);

  const ranges = ['Today', 'Last 7 Days', 'Month to Date', 'Last Quarter', 'Custom'];

  const handleApplyCustom = () => {
    if (tempStart && tempEnd) {
      setGlobalCustomStart(tempStart);
      setGlobalCustomEnd(tempEnd);
      setGlobalDateRange('Custom');
      setShowCustomModal(false);
    } else {
      alert("Please select both start and end dates.");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200/50 shadow-inner">
        {ranges.map(r => (
          <button 
            key={r}
            onClick={() => {
              if(r === 'Custom') {
                setShowCustomModal(true);
              } else {
                setGlobalDateRange(r);
              }
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${globalDateRange === r ? 'bg-white text-black shadow-sm border border-zinc-200/40' : 'text-zinc-500 hover:text-black hover:bg-zinc-200/50'}`}
          >
            {r}
          </button>
        ))}
      </div>

      {showCustomModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold mb-4">Custom Precise Range</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Start Date</label>
                <input 
                  type="date" 
                  value={tempStart} 
                  onChange={(e) => setTempStart(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">End Date</label>
                <input 
                  type="date" 
                  value={tempEnd} 
                  onChange={(e) => setTempEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button 
                onClick={() => setShowCustomModal(false)}
                className="px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleApplyCustom}
                className="px-4 py-2 bg-black text-white text-sm font-bold rounded-lg hover:bg-zinc-800 transition-colors shadow-sm"
              >
                Apply Dual-Calendar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalDateFilter;
