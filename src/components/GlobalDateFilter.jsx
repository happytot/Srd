import React, { useState } from 'react';

const GlobalDateFilter = ({
  globalDateRange,
  setGlobalDateRange,
  globalCustomStart,
  setGlobalCustomStart,
  globalCustomEnd,
  setGlobalCustomEnd,
}) => {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [tempStart, setTempStart] = useState(globalCustomStart);
  const [tempEnd, setTempEnd] = useState(globalCustomEnd);

  // Calendar state
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());

  const ranges = ['Today', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Custom'];

  const handleApplyCustom = () => {
    if (tempStart && tempEnd) {
      setGlobalCustomStart(tempStart);
      setGlobalCustomEnd(tempEnd);
      setGlobalDateRange('Custom');
      setShowCustomModal(false);
    } else {
      alert('Please select both start and end dates.');
    }
  };

  // Calendar helpers
  const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month, year) => new Date(year, month, 1).getDay();

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(viewMonth, viewYear);
    const firstDay = getFirstDayOfMonth(viewMonth, viewYear);
    const days = [];

    // Empty slots before first day
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-9" />);
    }

    const today = new Date();
    const isToday = (day) => today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isSelected = globalDateRange === 'Custom' && globalCustomStart === dateStr;

      days.push(
        <button
          key={day}
          onClick={() => {
            // Single day selection: set both start and end to clicked date
            setGlobalCustomStart(dateStr);
            setGlobalCustomEnd(dateStr);
            setGlobalDateRange('Custom');
            setShowCustomModal(false);
          }}
          className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium transition-all
            ${isToday(day) ? 'bg-emerald-100 text-emerald-700 font-bold' : ''}
            ${isSelected ? 'bg-black text-white' : 'hover:bg-zinc-100'}
          `}
        >
          {day}
        </button>
      );
    }
    return days;
  };

  const changeMonth = (increment) => {
    let newMonth = viewMonth + increment;
    let newYear = viewYear;
    if (newMonth > 11) { newMonth = 0; newYear++; }
    if (newMonth < 0) { newMonth = 11; newYear--; }
    setViewMonth(newMonth);
    setViewYear(newYear);
  };

  const monthName = new Date(viewYear, viewMonth).toLocaleString('default', { month: 'long' });

  return (
    <>
      {/* Preset Quick Buttons */}
      <div className="flex flex-wrap items-center gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200/50 shadow-inner">
        {ranges.map((range) => (
          <button
            key={range}
            onClick={() => {
              if (range === 'Custom') {
                setShowCustomModal(true);
              } else {
                setGlobalDateRange(range);
              }
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${globalDateRange === range
                ? 'bg-white text-black shadow-sm border border-zinc-200/40'
                : 'text-zinc-500 hover:text-black hover:bg-zinc-200/50'
              }`}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Visual Calendar Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between bg-zinc-50">
              <button onClick={() => changeMonth(-1)} className="text-xl hover:text-black">‹</button>
              <div className="text-center font-semibold text-lg">
                {monthName} {viewYear}
              </div>
              <button onClick={() => changeMonth(1)} className="text-xl hover:text-black">›</button>
            </div>

            {/* Calendar Grid */}
            <div className="p-6">
              {/* Weekday headers */}
              <div className="grid grid-cols-7 text-center text-xs font-medium text-zinc-400 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>

              {/* Date grid */}
              <div className="grid grid-cols-7 gap-1 text-center">
                {renderCalendar()}
              </div>

              {/* Range picker fallback */}
              <div className="mt-8 border-t pt-6">
                <p className="text-xs font-medium text-zinc-500 mb-3">Or pick a custom range:</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={tempStart}
                      onChange={(e) => setTempStart(e.target.value)}
                      className="w-full px-4 py-3 border border-zinc-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={tempEnd}
                      onChange={(e) => setTempEnd(e.target.value)}
                      className="w-full px-4 py-3 border border-zinc-200 rounded-xl"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex justify-end gap-3 px-6 py-5 border-t bg-zinc-50">
              <button
                onClick={() => setShowCustomModal(false)}
                className="px-6 py-3 text-zinc-600 hover:bg-zinc-100 rounded-xl font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyCustom}
                className="px-6 py-3 bg-black text-white font-bold rounded-xl hover:bg-zinc-800"
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GlobalDateFilter;