/**
 * True for admin regardless of casing (e.g. "Admin", "admin", "ADMIN").
 *
 * Firestore Security Rules — match both stored spellings on delete, for example:
 *
 *   match /expenses/{expenseId} {
 *     allow read, create: if request.auth != null;
 *     allow delete: if request.auth != null &&
 *       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['Admin', 'admin'];
 *   }
 *
 * Or compare case-insensitively if your rules version supports string transforms on your stored value.
 */
export function isAdminRole(role) {
  return String(role ?? '').toLowerCase() === 'admin';
}
