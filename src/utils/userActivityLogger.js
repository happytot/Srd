import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Flexible User Activity Logger for SRD + POS
 */

export function logUserAction(user, action, meta = {}, subsystem = 'SRD') {
  if (!user?.uid || !action) return;

  try {
    addDoc(collection(db, 'activity_logs'), {
      uid: user.uid,
      name: user.name || user.email?.split('@')[0] || 'Unknown User',
      email: user.email || '',
      role: user.role || '',
      subsystem: subsystem,
      action,
      meta: meta || {},
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Failed to log user action:', error);
  }
}

export async function startUserSession(user, subsystem = 'SRD') {
  if (!user?.uid) return null;

  const clientId = getClientId();
  const sessionId = `${user.uid}_${subsystem}_${clientId}`;
  const sessionRef = doc(db, 'user_sessions', sessionId);

  try {
    await setDoc(sessionRef, {
      uid: user.uid,
      name: user.name || user.email || 'Unknown User',
      email: user.email || '',
      role: user.role || '',
      subsystem: subsystem,
      status: 'online',
      loginAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      clientId: clientId,
    }, { merge: true });

    await logUserAction(user, 'LOGIN', {
      subsystem: subsystem,
      message: `User logged into ${subsystem} system`
    }, subsystem);

    return sessionId;
  } catch (error) {
    console.error('Failed to start user session:', error);
    return null;
  }
}

export async function endUserSession(sessionId, user, subsystem = 'SRD') {
  if (!sessionId) return;

  try {
    await updateDoc(doc(db, 'user_sessions', sessionId), {
      status: 'offline',
      logoutAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });

    if (user) {
      await logUserAction(user, 'LOGOUT', {
        subsystem: subsystem,
        message: `User logged out of ${subsystem} system`
      }, subsystem);
    }
  } catch (error) {
    console.error('Failed to end user session:', error);
  }
}

/** Heartbeat - Keep session alive */
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

function getClientId() {
  let id = localStorage.getItem('clientId');
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('clientId', id);
  }
  return id;
}