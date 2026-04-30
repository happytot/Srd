import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const SUBSYSTEM = 'SRD';
const CLIENT_ID_KEY = 'srdClientId';

/**
 * Generates or retrieves a persistent client ID from localStorage.
 * Used to uniquely identify the same browser/tab session.
 */
function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/**
 * Generates a unique session document ID for Firestore.
 */
export function getSessionDocId(uid) {
  if (!uid) throw new Error('uid is required for session ID');
  return `${uid}_${SUBSYSTEM}_${getClientId()}`;
}

/**
 * Start a new user session (or update existing one).
 */
export async function startUserSession(user) {
  if (!user?.uid) {
    console.error('startUserSession: user.uid is required');
    return null;
  }

  const sessionId = getSessionDocId(user.uid);
  const sessionRef = doc(db, 'user_sessions', sessionId);

  try {
    await setDoc(
      sessionRef,
      {
        uid: user.uid,
        name: user.name || user.email || 'Unknown User',
        email: user.email || '',
        role: user.role || '',
        subsystem: SUBSYSTEM,
        status: 'online',
        loginAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        clientId: getClientId(),
      },
      { merge: true }
    );
    return sessionId;
  } catch (error) {
    console.error('Failed to start user session:', error);
    return null;
  }
}

/**
 * Update lastSeenAt to keep session alive (called periodically).
 */
export async function heartbeatSession(sessionId) {
  if (!sessionId) return;

  try {
    await updateDoc(doc(db, 'user_sessions', sessionId), {
      status: 'online',
      lastSeenAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Heartbeat failed:', error);
  }
}

/**
 * Mark session as offline on logout.
 */
export async function endUserSession(sessionId) {
  if (!sessionId) return;

  try {
    await updateDoc(doc(db, 'user_sessions', sessionId), {
      status: 'offline',
      logoutAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Failed to end user session:', error);
  }
}

/**
 * Log any user action to the activity_logs collection.
 */
export async function logUserAction(user, action, meta = {}) {
  if (!user?.uid || !action) {
    console.error('logUserAction: user.uid and action are required');
    return;
  }

  try {
    await addDoc(collection(db, 'activity_logs'), {
      uid: user.uid,
      name: user.name || user.email || 'Unknown User',
      email: user.email || '',
      role: user.role || '',
      subsystem: SUBSYSTEM,
      action,
      meta: meta || {},
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Failed to log user action:', error);
  }
}