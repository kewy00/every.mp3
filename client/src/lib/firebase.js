import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);

let auth = null;
let db = null;
let googleProvider = null;

if (isFirebaseConfigured) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export function subscribeAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function loginWithGoogle() {
  if (!auth || !googleProvider) {
    throw new Error('Firebase aún no está configurado en .env');
  }
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logoutGoogle() {
  if (!auth) return;
  await signOut(auth);
}

export async function loadUserPreferences(uid) {
  if (!db || !uid) return null;
  const snap = await getDoc(doc(db, 'every_mp3_users', uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveUserPreferences(uid, prefs) {
  if (!db || !uid) return;
  await setDoc(
    doc(db, 'every_mp3_users', uid),
    {
      ...prefs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function subscribeUserHistory(uid, callback) {
  if (!db || !uid) return () => {};
  const q = query(collection(db, 'every_mp3_users', uid, 'history'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    callback(items);
  });
}

export async function addUserHistoryItem(uid, item) {
  if (!db || !uid) return null;
  const ref = await addDoc(collection(db, 'every_mp3_users', uid, 'history'), {
    title: String(item.title || '').slice(0, 200),
    author: String(item.author || '').slice(0, 160),
    platform: String(item.platform || '').slice(0, 60),
    url: String(item.url || '').slice(0, 500),
    type: item.type === 'video' ? 'video' : 'audio',
    format: String(item.format || '').slice(0, 40),
    size: String(item.size || '').slice(0, 40),
    thumbnail: String(item.thumbnail || '').slice(0, 600),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteUserHistoryItem(uid, itemId) {
  if (!db || !uid || !itemId) return;
  await deleteDoc(doc(db, 'every_mp3_users', uid, 'history', itemId));
}

export async function clearUserHistory(uid) {
  if (!db || !uid) return;
  const snap = await getDocs(collection(db, 'every_mp3_users', uid, 'history'));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
