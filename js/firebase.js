// =============================================================
// Firebase initialization (Auth + Firestore).
// The modular SDK is imported directly from Google's CDN:
// no npm or build step needed.
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
  serverTimestamp,
  deleteField,
  arrayUnion,
  arrayRemove,
  runTransaction,
  Timestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig } from "./config.js";

// App Check: token de depuración solo en desarrollo local.
// El flag debe existir ANTES de inicializar App Check; en producción
// nunca se asigna (coincidencia exacta de hostname).
if (
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

export function login() {
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// Re-export the Firestore functions that db.js needs,
// so only this file knows the CDN URLs.
export {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
  serverTimestamp,
  deleteField,
  arrayUnion,
  arrayRemove,
  runTransaction,
  Timestamp,
  writeBatch,
};
