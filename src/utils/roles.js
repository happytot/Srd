/**
 * Role Utilities for SRD System
 * Both "Admin" and "Manager" have full access
 */

export function isAdminRole(role) {
  if (!role) return false;

  const normalizedRole = String(role).trim().toLowerCase();

  return normalizedRole === 'admin' || normalizedRole === 'manager';
}

/** Clearer name for new code */
export function hasFullAccess(role) {
  return isAdminRole(role);
}

export const FULL_ACCESS_ROLES = ['admin', 'manager'];

export default isAdminRole;