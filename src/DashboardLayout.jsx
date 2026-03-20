// A reusable component for the four main KPI metric cards
const KPIStatCard = ({ title, value, change, icon }) => (
  <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm flex flex-col gap-2 relative">
    <span className="absolute top-4 right-4 text-zinc-400 text-lg">{icon}</span>
    <p className="text-zinc-500 text-sm font-medium uppercase tracking-wide">{title}</p>
    <p className="text-4xl font-semibold text-zinc-900">{value}</p>
    <div className={`text-sm ${change.startsWith('+') ? 'text-emerald-600' : 'text-zinc-500'}`}>
      <span className="font-bold">{change}</span> <span className="text-zinc-500">vs yesterday</span>
    </div>
  </div>
);

// The main layout component
const DashboardLayout = () => {
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 font-sans">

      {/* 1. SIDEBAR (Simplified for this example) */}
      <aside className="w-64 bg-white border-r border-zinc-200 p-6 flex flex-col justify-between">
        <div>
          <h1 className="text-2xl font-bold">Coffee & Tea</h1>
          <nav className="mt-10 space-y-4">
            <a href="#" className="flex items-center gap-3 p-3 rounded-lg bg-black text-white font-medium">Overview</a>
            <a href="#" className="flex items-center gap-3 p-3 text-zinc-600 hover:bg-zinc-100 rounded-lg">Reports</a>
            <a href="#" className="flex items-center gap-3 p-3 text-zinc-600 hover:bg-zinc-100 rounded-lg">Alerts</a>
          </nav>
        </div>
        <div className="border-t pt-4">Profile Section</div>
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <main className="flex-1 p-10">

        {/* Header and Search */}
        <header className="flex items-center justify-between mb-10">
          <h2 className="text-3xl font-bold">Dashboard Overview</h2>
          <input type="search" placeholder="Search reports..." className="w-80 p-3 bg-white rounded-lg border border-zinc-200" />
        </header>

        {/* 3. THE FOUR KPI CARDS (Grid Layout) */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
          <KPIStatCard title="TODAY'S SALES" value="12,450.00" change="+12.5%" icon="" />
          <KPIStatCard title="TOTAL ORDERS" value="84" change="+5.2%" icon="" />
          <KPIStatCard title="AVG. ORDER VALUE" value="320.00" change="+2.1%" icon="" />
          <KPIStatCard title="TOP PRODUCT" value="Caramel Latte" change="42 units sold" icon="" />
        </section>

        {/* 4. LOWER CONTENT GRID (Placeholder for Chart & Alerts) */}
        <section className="grid grid-cols-3 gap-6">
          {/* Sales Trend Placeholder (2/3 width) */}
          <div className="col-span-2 bg-white p-8 rounded-xl border border-zinc-200 h-96">
            Chart component goes here.
          </div>

          {/* Low Stock Placeholder (1/3 width) */}
          <div className="bg-white p-8 rounded-xl border border-zinc-200 h-96">
            Alerts component goes here.
          </div>
        </section>

      </main>
    </div>
  );
};

export default DashboardLayout;