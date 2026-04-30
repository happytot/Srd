/**
 * Role utility for the Coffee & Tea Sales Dashboard.
 *
 * Returns true if the user has admin privileges.
 * Case-insensitive check (e.g. "Admin", "admin", "ADMIN", "ADMINISTRATOR" etc.).
 *
 * This is used both in the frontend (UI hiding) and referenced in Firestore
 * security rules for sensitive operations (delete, user management, etc.).
 */
export function isAdminRole(role) {
  if (!role) return false;
  return String(role).toLowerCase() === 'admin';
}

/**
 * Optional helper for future expansion (kept for clarity).
 * Currently only "admin" is considered admin, but this makes it easy to add
 * more roles later without changing every call site.
 */
export const ADMIN_ROLES = ['admin'];

export default isAdminRole;