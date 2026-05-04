import React, { useState, useEffect, useCallback } from 'react';
import { db, secondaryAuth, auth } from './firebase';
import { Search, UserPlus, Mail, RefreshCw, Trash2, Edit } from 'lucide-react';
import { 
  collection, getDocs, doc, setDoc, updateDoc, addDoc, 
  serverTimestamp, query, orderBy, limit, where, deleteDoc 
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from 'firebase/auth';

const UserManagement = ({ currentUser }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [auditLogs, setAuditLogs] = useState([]);

  const [newUserName, setNewUserName] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserConfirmPassword, setNewUserConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [newUserRole, setNewUserRole] = useState('cashier');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const itemsPerPage = 5;

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const userList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUsers(userList);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAuditLogs(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchAuditLogs();
  }, [fetchUsers, fetchAuditLogs]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormError('');
    setIsSubmitting(true);

    try {
      if (!newUserUsername) {
        setFormError('Username is required.');
        setIsSubmitting(false);
        return;
      }

      if (newUserPassword !== newUserConfirmPassword) {
        setFormError('Passwords do not match.');
        setIsSubmitting(false);
        return;
      }

      // Check if username already exists
      const q = query(collection(db, 'users'), where('username', '==', newUserUsername));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setFormError('An account with this username already exists.');
        setIsSubmitting(false);
        return;
      }

      const emailToUse = newUserEmail || `${newUserUsername}@coffee.com`;

      // Create user with secondary auth (keeps admin logged in)
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, emailToUse, newUserPassword);
      const newUid = userCred.user.uid;

      // Set the displayName in Firebase Auth so the POS system can fetch it
      await updateProfile(userCred.user, {
        displayName: newUserName
      });

      // Add to Firestore
      await setDoc(doc(db, 'users', newUid), {
        name: newUserName,
        username: newUserUsername,
        email: emailToUse,
        role: newUserRole,
        status: 'Active',
        createdAt: serverTimestamp(),
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(newUserName)}`
      });

      // Audit log
      await addDoc(collection(db, 'audit_logs'), {
        action: 'CREATE_USER',
        adminId: currentUser.uid,
        adminEmail: currentUser.email,
        targetUserId: newUid,
        targetUserEmail: emailToUse,
        timestamp: serverTimestamp(),
        details: `Created new user ${newUserName} (${newUserUsername}) with role ${newUserRole}`
      });

      // Reset form
      setIsModalOpen(false);
      setNewUserName('');
      setNewUserUsername('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setNewUserRole('cashier');

      // Refresh data
      await fetchUsers();
      await fetchAuditLogs();
    } catch (err) {
      console.error("Error creating user:", err);
      setFormError(err.message || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (userId, currentStatus, userEmail) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    
    try {
      await updateDoc(doc(db, 'users', userId), { status: newStatus });
      
      await addDoc(collection(db, 'audit_logs'), {
        action: 'UPDATE_USER_STATUS',
        adminId: currentUser.uid,
        adminEmail: currentUser.email,
        targetUserId: userId,
        targetUserEmail: userEmail,
        newStatus,
        timestamp: serverTimestamp(),
        details: `Updated user status to ${newStatus}`
      });

      await fetchUsers();
      await fetchAuditLogs();
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const handleResetPassword = async (userEmail) => {
    if (!window.confirm(`Send a password reset email to ${userEmail}?`)) return;

    try {
      await sendPasswordResetEmail(auth, userEmail);
      alert(`Password reset email sent to ${userEmail}`);

      await addDoc(collection(db, 'audit_logs'), {
        action: 'PASSWORD_RESET',
        adminId: currentUser.uid,
        adminEmail: currentUser.email,
        targetUserEmail: userEmail,
        timestamp: serverTimestamp(),
        details: `Sent password reset email to ${userEmail}`
      });

      await fetchAuditLogs();
    } catch (error) {
      console.error(error);
      alert("Failed to send reset email: " + error.message);
    }
  };

  const handleChangeRole = async (userId, newRole, userEmail) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });

      await addDoc(collection(db, 'audit_logs'), {
        action: 'UPDATE_USER_ROLE',
        adminId: currentUser.uid,
        adminEmail: currentUser.email,
        targetUserId: userId,
        targetUserEmail: userEmail,
        newRole,
        timestamp: serverTimestamp(),
        details: `Updated user role to ${newRole}`
      });

      await fetchUsers();
      await fetchAuditLogs();
    } catch (error) {
      console.error(error);
      alert("Failed to update role");
    }
  };

  const confirmDelete = (user) => {
    setUserToDelete(user);
    setDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (!userToDelete) return;

    try {
      // Soft delete since hard deletes are forbidden by Firebase security rules
      await updateDoc(doc(db, 'users', userToDelete.id), { status: 'Deleted' });
      
      await addDoc(collection(db, 'audit_logs'), {
        action: 'DELETE_USER',
        adminId: currentUser.uid,
        adminEmail: currentUser.email,
        targetUserId: userToDelete.id,
        targetUserEmail: userToDelete.email,
        timestamp: serverTimestamp(),
        details: `Deleted user ${userToDelete.name}`
      });

      await fetchUsers();
      await fetchAuditLogs();
      setDeleteModalOpen(false);
      setUserToDelete(null);
    } catch (error) {
      console.error("Error deleting user:", error);
      alert("Failed to delete user");
    }
  };

  // Filtered + Paginated users
  const filteredUsers = users.filter(user => user.status !== 'Deleted').filter(user =>
    user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.role?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getStatusBadge = (status) => {
    const base = 'inline-flex items-center rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide';
    if (status === 'Active') return `${base} text-emerald-700 bg-emerald-100 ring-1 ring-emerald-600/20`;
    if (status === 'Inactive') return `${base} text-zinc-600 bg-zinc-100 ring-1 ring-zinc-500/20`;
    if (status === 'Pending') return `${base} text-amber-700 bg-amber-100 ring-1 ring-amber-600/20`;
    return `${base} text-zinc-600 bg-zinc-100 ring-1 ring-zinc-500/20`;
  };

  const getRoleBadge = (role) => {
    const base = 'inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold border';
    if (role === 'Admin' || role === 'admin') return `${base} text-indigo-700 bg-indigo-50 border-indigo-200`;
    if (role === 'Manager' || role === 'manager') return `${base} text-violet-700 bg-violet-50 border-violet-200`;
    if (role === 'Cashier' || role === 'cashier') return `${base} text-blue-700 bg-blue-50 border-blue-200`;
    return `${base} text-zinc-700 bg-zinc-50 border-zinc-200`;
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <div className="relative w-full sm:w-96">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search size={18} className="text-zinc-400" />
          </div>
          <input
            type="text"
            className="search-input !w-full !pl-10 !bg-white border !border-zinc-200"
            placeholder="Search by name, email, or role..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto px-4 py-2.5 bg-black text-white rounded-lg text-sm font-bold shadow-sm hover:bg-zinc-800 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <span>+</span> Add New User
        </button>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="p-12 text-center text-zinc-500">Loading users...</div>
      ) : (
        <div className="table-container mt-0 shadow-sm border border-zinc-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm md:text-base">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-6 py-4 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">User</th>
                  <th className="px-6 py-4 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-4 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-right text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {paginatedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <img 
                          className="h-10 w-10 rounded-full bg-zinc-100" 
                          src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} 
                          alt={user.name} 
                        />
                        <div className="ml-4">
                          <div className="font-bold text-zinc-900">{user.name}</div>
                          <div className="text-xs text-zinc-500">@{user.username || user.email?.split('@')[0]}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select 
                        value={user.role?.toLowerCase() || ''}
                        onChange={(e) => handleChangeRole(user.id, e.target.value, user.email)}
                        className={`cursor-pointer outline-none appearance-none ${getRoleBadge(user.role)}`}
                      >
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="cashier">Cashier</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={getStatusBadge(user.status)}>
                        {user.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => handleResetPassword(user.email)}
                        className="text-indigo-600 hover:text-indigo-900 font-bold transition-colors mr-3"
                        title="Reset Password"
                      >
                        Reset Pwd
                      </button>
                      <button 
                        onClick={() => handleToggleStatus(user.id, user.status || 'Active', user.email)}
                        className={`${(user.status || 'Active') === 'Active' ? 'text-amber-600 hover:text-amber-900' : 'text-emerald-600 hover:text-emerald-900'} font-bold transition-colors mr-3`}
                      >
                        {(user.status || 'Active') === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button 
                        onClick={() => confirmDelete(user)}
                        className="text-rose-600 hover:text-rose-900 font-bold transition-colors"
                        title="Delete User"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-6 py-16 text-center text-zinc-500">
                      <div className="flex justify-center mb-3">
                        <Search size={48} className="text-zinc-300" />
                      </div>
                      <p className="text-lg font-medium text-zinc-900">No users found</p>
                      <p className="mt-1">No users match your search</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-between text-xs text-zinc-500 bg-zinc-50/50">
              <span>
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredUsers.length)} of {filteredUsers.length} entries
              </span>
              <div className="flex gap-1">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50"
                >
                  Previous
                </button>
                <button className="px-3 py-1 bg-black text-white rounded">{currentPage}</button>
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 border border-zinc-200 rounded hover:bg-zinc-100 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit Logs */}
      <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
        <h3 className="text-lg font-bold mb-4">Recent System Activity</h3>
        <div className="space-y-3">
          {auditLogs.length > 0 ? (
            auditLogs.map(log => (
              <div key={log.id} className="text-sm flex items-start gap-3 bg-zinc-50 p-3 rounded-lg border border-zinc-100">
                <span className="flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-white border border-zinc-200 shadow-sm mt-0.5">
                  {log.action === 'CREATE_USER' ? <UserPlus size={14} className="text-emerald-500" /> : 
                   log.action === 'PASSWORD_RESET' ? <Mail size={14} className="text-indigo-500" /> : 
                   log.action === 'UPDATE_USER_STATUS' ? <RefreshCw size={14} className="text-blue-500" /> : 
                   log.action === 'DELETE_USER' ? <Trash2 size={14} className="text-rose-500" /> : 
                   <Edit size={14} className="text-amber-500" />}
                </span>
                <div>
                  <p className="font-medium text-zinc-900">{log.details}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    By: {log.adminEmail || 'System'} • {log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : 'Just now'}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">No recent activity.</p>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-4">Add New User</h2>
            
            <form onSubmit={handleAddUser} className="space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium">{formError}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Full Name</label>
                <input 
                  required 
                  type="text" 
                  value={newUserName} 
                  onChange={e => setNewUserName(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl" 
                  placeholder="John Doe" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Username</label>
                <input 
                  required 
                  type="text" 
                  value={newUserUsername} 
                  onChange={e => setNewUserUsername(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl" 
                  placeholder="johndoe" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Email Address <span className="text-zinc-400 font-normal">(Optional)</span></label>
                <input 
                  type="email" 
                  value={newUserEmail} 
                  onChange={e => setNewUserEmail(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl" 
                  placeholder="john@example.com" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Temporary Password</label>
                <div className="relative">
                  <input 
                    required 
                    type={showPassword ? "text" : "password"} 
                    value={newUserPassword} 
                    onChange={e => setNewUserPassword(e.target.value)} 
                    className="w-full px-3 py-2 pr-10 border rounded-xl" 
                    placeholder="Minimum 6 characters" 
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 focus:outline-none"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Confirm Password</label>
                <div className="relative">
                  <input 
                    required 
                    type={showConfirmPassword ? "text" : "password"} 
                    value={newUserConfirmPassword} 
                    onChange={e => setNewUserConfirmPassword(e.target.value)} 
                    className="w-full px-3 py-2 pr-10 border rounded-xl" 
                    placeholder="Minimum 6 characters" 
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 focus:outline-none"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Role</label>
                <select 
                  value={newUserRole} 
                  onChange={e => setNewUserRole(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-100">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting} 
                  className="px-4 py-2 bg-black text-white rounded-xl font-bold hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && userToDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-2 text-rose-600">Delete User?</h2>
            <p className="text-zinc-600 mb-6 text-sm">
              Are you sure you want to delete <strong>{userToDelete.name}</strong>? This will permanently remove their access.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setDeleteModalOpen(false);
                  setUserToDelete(null);
                }}
                className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-xl font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeDelete}
                className="px-4 py-2 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;