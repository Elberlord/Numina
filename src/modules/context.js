import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  addDoc,
  onSnapshot,
  writeBatch,
  runTransaction,
  Timestamp
} from 'firebase/firestore';

'use strict';

const firebaseConfig = {
  apiKey: 'AIzaSyA-5mCIkzfgg0qBB4btEM9F0YPfSbPhfcQ',
  authDomain: 'nomina-23755.firebaseapp.com',
  projectId: 'nomina-23755',
  storageBucket: 'nomina-23755.firebasestorage.app',
  messagingSenderId: '1070622502243',
  appId: '1:1070622502243:web:4fa1253837b3881711f756'
};

const ADMIN_UID = '6zJhAeRF9JRAilw6yvQQvLiN8bc2';
const ENTRY_MODE = document.body.dataset.entry || 'device';
const ACCESS_WHATSAPP = '50664305227';
const APP_VERSION = 'firebase-completa-v3.6.1-series';
const LEGACY_STORAGE_KEY = 'numina_github_pages_data_v1';
const ADMIN_DEVICE_ID_KEY = 'numina_admin_device_id_v1';
const ADMIN_DEVICE_NAME_KEY = 'numina_admin_device_name_v1';
const PIN_FAILURES_PREFIX = 'numina_pin_failures_';
const PIN_ITERATIONS = 210000;
const ERROR_LOG_PREFIX = 'numina_error_log_';
const LAST_SYNC_PREFIX = 'numina_last_sync_';
const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const IMPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const ENTITY_COLLECTIONS = ['campaigns', 'sales', 'results', 'deliveries'];

const FIREBASE_APP_NAME = ENTRY_MODE === 'admin' ? 'numina-admin' : 'numina-device';
const app = initializeApp(firebaseConfig, FIREBASE_APP_NAME);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
setPersistence(auth, browserLocalPersistence).catch(console.error);

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const state = {
  user: null,
  admin: false,
  actor: null,
  device: null,
  request: null,
  lease: null,
  unlocked: false,
  pinMode: 'unlock',
  activeView: 'dashboard',
  deferredInstallPrompt: null,
  data: emptyData(),
  collectionLoaded: new Set(),
  pendingByCollection: {},
  dataUnsubs: [],
  accessUnsub: null,
  leaseTimer: null,
  adminLoaded: false,
  writeBusy: false,
  generatedKey: null,
  privacyMode: sessionStorage.getItem('numina_privacy_mode') === '1',
  pendingImportPlan: null,
  pendingPrintView: null,
  lastSyncAt: 0,
  serviceWorkerRegistration: null
};

function emptyData() {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    campaigns: [],
    sales: [],
    results: [],
    deliveries: []
  };
}

export { firebaseConfig, ADMIN_UID, ENTRY_MODE, ACCESS_WHATSAPP, APP_VERSION, LEGACY_STORAGE_KEY, ADMIN_DEVICE_ID_KEY, ADMIN_DEVICE_NAME_KEY, PIN_FAILURES_PREFIX, PIN_ITERATIONS, ERROR_LOG_PREFIX, LAST_SYNC_PREFIX, IMPORT_MAX_BYTES, IMPORT_ID_PATTERN, ENTITY_COLLECTIONS, app, auth, db, $, $$, state, emptyData };
