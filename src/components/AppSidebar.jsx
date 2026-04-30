import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { isAdminRole } from '../utils/roles';

const AppSidebar = ({ user, navItems, activeTab, setActiveTab }) => {
  return (
    <aside className="sidebar">
      {/* Logo & Brand */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          C
        </div>
        <div>
          <h1 className="text-sm font-bold leading-none">Coffee & Tea</h1>
          <p className="text-[10px] text-zinc-400 mt-1">Sales Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 flex-1 overflow-y-auto pr-1">
        {navItems.map((item) => (
          <div
            key={item.name}
            onClick={() => setActiveTab(item.name)}
            className={`nav-item ${activeTab === item.name ? 'nav-item-active' : 'nav-item-inactive'}`}
          >
            <span>{item.icon} {item.name}</span>
          </div>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-zinc-100 pt-4 mt-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-zinc-200 overflow-hidden flex-shrink-0">
          <img
            src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name || 'User'}`}
            alt={`${user.name || 'User'} avatar`}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="overflow-hidden flex-1">
          <p className="text-xs font-bold truncate">{user.name}</p>
          <span
            className={
              isAdminRole(user.role)
                ? 'badge-admin'
                : 'text-[10px] font-bold uppercase tracking-wider text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full'
            }
          >
            {user.role}
          </span>
        </div>

        <button
          onClick={() => signOut(auth)}
          className="text-[10px] font-bold text-zinc-400 hover:text-red-500 transition-colors uppercase whitespace-nowrap"
        >
          Logout
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;