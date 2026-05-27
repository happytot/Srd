import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc, query, where, getDocs, getDoc } from 'firebase/firestore';
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
    // Check if there is already an active/recent online session for this client to prevent duplicate LOGIN logging on page refresh
    let isAlreadyActive = false;
    try {
      const docSnap = await getDoc(sessionRef);
      if (docSnap.exists() && docSnap.data().status === 'online') {
        const lastSeen = docSnap.data().lastSeenAt?.toDate?.() || null;
        // If last seen was within the last 5 minutes, treat it as a page refresh/tab restore rather than a new login
        if (lastSeen && (Date.now() - lastSeen.getTime() < 5 * 60 * 1000)) {
          isAlreadyActive = true;
        }
      }
    } catch (readErr) {
      console.warn('Could not read existing session doc:', readErr);
    }

    const sessionData = {
      uid: user.uid,
      name: user.name || user.email || 'Unknown User',
      email: user.email || '',
      role: user.role || '',
      subsystem: subsystem,
      status: 'online',
      lastSeenAt: serverTimestamp(),
      clientId: clientId,
    };

    // If it's a completely new session, also update loginAt timestamp
    if (!isAlreadyActive) {
      sessionData.loginAt = serverTimestamp();
    }

    await setDoc(sessionRef, sessionData, { merge: true });

    // Only log a new LOGIN activity if the session was not already active (helps keep logs clean)
    if (!isAlreadyActive) {
      await logUserAction(user, 'LOGIN', {
        subsystem: subsystem,
        message: `User logged into ${subsystem} system`
      }, subsystem);
    }

    return sessionId;
  } catch (error) {
    console.error('Failed to start user session:', error);
    return null;
  }
}

export async function endUserSession(sessionId, user, subsystem = 'SRD') {
  if (!sessionId && !user?.uid) return;

  try {
    // 1. End the specific session if ID is provided
    if (sessionId) {
      try {
        await updateDoc(doc(db, 'user_sessions', sessionId), {
          status: 'offline',
          logoutAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        });
      } catch (docErr) {
        console.warn('Failed to update specific session doc:', docErr);
      }
    }

    // 2. Query and close any other online sessions for this user in Firestore
    if (user?.uid) {
      const q = query(
        collection(db, 'user_sessions'),
        where('uid', '==', user.uid),
        where('status', '==', 'online')
      );
      const snapshot = await getDocs(q);
      const promises = snapshot.docs.map(docSnap => {
        return updateDoc(docSnap.ref, {
          status: 'offline',
          logoutAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        });
      });
      await Promise.all(promises);
    }

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