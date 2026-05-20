import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { LogOut } from 'lucide-react';
import { isAdminRole } from '../utils/roles';
import { endUserSession } from '../utils/userActivityLogger';

const AppSidebar = ({ user, navItems, activeTab, setActiveTab }) => {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  return (
    <aside className="sidebar">
      {/* Logo & Brand */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
          <img src="/assets/coffeeandtealogo.png" alt="Coffee & Tea Logo" className="w-full h-full object-contain" />
        </div>
        <div>
          <h1 className="text-sm font-bold leading-none">Coffee & Tea Connection</h1>
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
                : user.role?.toLowerCase() === 'cashier'
                  ? 'text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full'
                  : 'text-[10px] font-bold uppercase tracking-wider text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full'
            }
          >
            {user.role?.toLowerCase() === 'cashier' ? 'BARISTA' : user.role}
          </span>
        </div>

        <button
          onClick={() => setShowLogoutModal(true)}
          className="flex items-center gap-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-lg transition-all active:scale-[0.98] uppercase whitespace-nowrap border border-rose-100 shadow-sm"
        >
          <LogOut size={12} /> Logout
        </button>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mb-4 text-rose-600 mx-auto">
                <LogOut size={24} />
              </div>
              <h3 className="text-lg font-bold text-center text-zinc-900 mb-2">Ready to leave?</h3>
              <p className="text-sm text-zinc-500 text-center mb-6">
                Are you sure you want to sign out?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    // End session before signing out
                    const sessionId = `${user.uid}_SRD_${localStorage.getItem('srdClientId')}`;
                    if (sessionId) {
                      await endUserSession(sessionId, user);   // ← Important
                    }
                    setShowLogoutModal(false);
                    signOut(auth);
                  }}
                  className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
                >
                  Yes, Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default AppSidebar;