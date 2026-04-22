import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const SUBSYSTEM = 'SRD';
const CLIENT_ID_KEY = 'srdClientId';

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getSessionDocId(uid) {
  return `${uid}_${SUBSYSTEM}_${getClientId()}`;
}

export async function startUserSession(user) {
  const sessionId = getSessionDocId(user.uid);
  const sessionRef = doc(db, 'user_sessions', sessionId);
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
      clientId: getClientId()
    },
    { merge: true }
  );
  return sessionId;
}

export async function heartbeatSession(sessionId) {
  await updateDoc(doc(db, 'user_sessions', sessionId), {
    status: 'online',
    lastSeenAt: serverTimestamp()
  });
}

export async function endUserSession(sessionId) {
  await updateDoc(doc(db, 'user_sessions', sessionId), {
    status: 'offline',
    logoutAt: serverTimestamp(),
    lastSeenAt: serverTimestamp()
  });
}

export async function logUserAction(user, action, meta = {}) {
  await addDoc(collection(db, 'activity_logs'), {
    uid: user.uid,
    name: user.name || user.email || 'Unknown User',
    email: user.email || '',
    role: user.role || '',
    subsystem: SUBSYSTEM,
    action,
    meta,
    createdAt: serverTimestamp()
  });
}
