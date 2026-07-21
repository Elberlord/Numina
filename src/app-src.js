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
let autoRequestStarted = false;
const APP_VERSION = 'firebase-completa-v1.1.1-temp-key';
const LEGACY_STORAGE_KEY = 'numina_github_pages_data_v1';
const ADMIN_DEVICE_ID_KEY = 'numina_admin_device_id_v1';
const ADMIN_DEVICE_NAME_KEY = 'numina_admin_device_name_v1';
const PIN_FAILURES_PREFIX = 'numina_pin_failures_';
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
  generatedKey: null
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

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function userKey(prefix) {
  return `${prefix}${state.user?.uid || 'none'}`;
}

function pinKey() {
  return userKey('numina_pin_hash_');
}

function leaseKey() {
  return userKey('numina_lease_');
}

function actorNameKey() {
  return userKey('numina_actor_name_');
}

function getAdminDeviceId() {
  let id = localStorage.getItem(ADMIN_DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(ADMIN_DEVICE_ID_KEY, id);
  }
  return id;
}

function defaultDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Dispositivo';
  const type = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'móvil' : 'PC';
  return `${platform} · ${type}`;
}

function currentDeviceId() {
  return state.admin ? getAdminDeviceId() : (state.user?.uid || '');
}

function currentDeviceName() {
  if (state.admin) return localStorage.getItem(ADMIN_DEVICE_NAME_KEY) || defaultDeviceName();
  return state.device?.deviceName || defaultDeviceName();
}

function isAdmin() {
  return state.admin;
}

function currentUser() {
  return state.actor;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeActivationKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateActivationKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function activationKeyWhatsAppUrl(key, userName, deviceName, expiresMinutes) {
  const message = [
    'Númina — clave temporal de acceso',
    '',
    `Persona: ${userName}`,
    `Dispositivo: ${deviceName}`,
    `Clave: ${key}`,
    `Vence en: ${expiresMinutes} minutos`,
    '',
    'Abre Númina, pulsa “Ingresar clave temporal” y copia esta clave.'
  ].join('\n');
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  })[character]);
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}


function accessWhatsAppUrl(request = {}) {
  const code = (state.user?.uid || request.uid || '').slice(0, 8).toUpperCase();
  const text = [
    'Hola, solicito acceso a Númina para este dispositivo.',
    `Código: ${code || 'SIN-CÓDIGO'}`,
    `Persona: ${request.userName || 'Sin indicar'}`,
    `Dispositivo: ${request.deviceName || defaultDeviceName()}`
  ].join('\n');
  return `https://wa.me/${ACCESS_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

function formatDate(value) {
  if (!value) return '—';
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    return new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return String(value);
  }
}

function formatAmount(value) {
  return new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function paymentLabel(status) {
  return ({ paid: 'Pagado', pending: 'Pendiente', cancelled: 'Cancelado' })[status] || status;
}

function campaignStatusLabel(status) {
  return status === 'active' ? 'Activa' : 'Cerrada';
}

function humanDuration(ms) {
  if (ms <= 0) return 'Vencido';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 48) return `${Math.floor(hours / 24)} d ${hours % 24} h`;
  return `${hours} h ${minutes} min`;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3000);
}

function showOnly(viewId) {
  ['bootView', 'accessView', 'requestView', 'activationView', 'gateView', 'pinView', 'appView'].forEach(id => {
    $(`#${id}`)?.classList.toggle('hidden', id !== viewId);
  });
}

function updateConnectionUi() {
  const online = navigator.onLine;
  const banner = $('#accessNetworkBanner');
  if (banner) {
    banner.className = `status-banner ${online ? 'online' : 'offline'}`;
    banner.textContent = online ? '● En línea: Firebase puede validar y sincronizar.' : '● Sin conexión: solo funciona un dispositivo previamente autorizado.';
  }
  $('#networkState').textContent = online ? '● En línea' : '● Sin conexión';
  updateSyncUi();
}

function authErrorMessage(error) {
  const map = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Espera y vuelve a probar.',
    'auth/network-request-failed': 'No hay conexión con Firebase.',
    'auth/operation-not-allowed': 'Debes activar este método de acceso en Firebase Authentication.'
  };
  return map[error.code] || error.message || 'No se pudo completar el acceso.';
}

function leaseHours() {
  return Number(state.device?.offlineHours || (state.admin ? 168 : 24));
}

function leaseRemaining() {
  if (!state.lease?.validatedAt || state.lease.uid !== state.user?.uid) return 0;
  return state.lease.validatedAt + leaseHours() * 3600000 - Date.now();
}

function storeLease() {
  state.lease = {
    uid: state.user.uid,
    validatedAt: Date.now(),
    offlineHours: leaseHours(),
    deviceId: currentDeviceId(),
    appVersion: APP_VERSION
  };
  writeJson(leaseKey(), state.lease);
}

function clearLocalAccess() {
  localStorage.removeItem(pinKey());
  localStorage.removeItem(leaseKey());
  localStorage.removeItem(userKey(PIN_FAILURES_PREFIX));
  state.lease = null;
  state.unlocked = false;
}

function gateDetail(label, value) {
  return `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function setGate(title, message, details = [], actions = '') {
  $('#gateTitle').textContent = title;
  $('#gateMessage').textContent = message;
  $('#gateDetails').innerHTML = details.map(([label, value]) => gateDetail(label, value)).join('');
  $('#gateActions').innerHTML = actions;
  showOnly('gateView');
}

function showBlocked(title, message) {
  stopDataSync();
  setGate(title, message, [
    ['Cuenta', state.user?.email || state.actor?.name || 'Dispositivo'],
    ['Código', (state.user?.uid || '').slice(0, 8).toUpperCase() || '—'],
    ['Conexión', navigator.onLine ? 'En línea' : 'Sin conexión']
  ], `<button id="retryAccessBtn" class="primary" type="button">Comprobar acceso</button><button id="blockedSignOutBtn" class="ghost" type="button">Cambiar de cuenta</button>`);
  $('#retryAccessBtn').onclick = () => evaluateAccess({ forceServer: true });
  $('#blockedSignOutBtn').onclick = () => signOut(auth);
}

function showPendingRequest(request) {
  state.request = request;
  const statusText = request.status === 'key_issued' ? 'Clave generada' : 'Esperando clave';
  setGate('Solicitud registrada', 'Envíale el código al administrador. Cuando recibas la clave temporal por WhatsApp, introdúcela aquí.', [
    ['Persona', request.userName || '—'],
    ['Dispositivo', request.deviceName || '—'],
    ['Código', state.user.uid.slice(0, 8).toUpperCase()],
    ['Estado', statusText]
  ], `<a id="whatsappRequestBtn" class="primary button-link" target="_blank" rel="noopener">Pedir clave por WhatsApp</a><button id="enterPendingKeyBtn" class="ghost" type="button">Ingresar clave temporal</button><button id="pendingSignOutBtn" class="link-button" type="button">Cancelar solicitud</button>`);
  $('#whatsappRequestBtn').href = accessWhatsAppUrl(request);
  $('#enterPendingKeyBtn').onclick = showActivationForm;
  $('#pendingSignOutBtn').onclick = () => signOut(auth);
}

function showActivationForm() {
  if (!(state.user?.isAnonymous || auth.currentUser?.isAnonymous)) return toast('Primero solicita acceso para crear la identidad de este dispositivo.');
  $('#activationForm').reset();
  showOnly('activationView');
  setTimeout(() => $('#activationForm input[name="activationKey"]')?.focus(), 50);
}

function showRequestForm() {
  const savedName = localStorage.getItem(actorNameKey()) || '';
  $('#requestForm input[name="userName"]').value = savedName;
  $('#requestForm input[name="deviceName"]').value = defaultDeviceName();
  showOnly('requestView');
}

function showPinSetup() {
  state.pinMode = 'setup';
  $('#pinTitle').textContent = 'Crear PIN local';
  $('#pinMessage').textContent = `Este PIN protegerá el acceso en este dispositivo. Permiso offline: ${leaseHours()} horas.`;
  $('#pinConfirmLabel').classList.remove('hidden');
  $('#pinForm input[name="pinConfirm"]').required = true;
  $('#pinForm').reset();
  showOnly('pinView');
}

function showPinUnlock() {
  state.pinMode = 'unlock';
  $('#pinTitle').textContent = 'Desbloquear Númina';
  $('#pinMessage').textContent = `Permiso offline restante: ${humanDuration(leaseRemaining())}.`;
  $('#pinConfirmLabel').classList.add('hidden');
  $('#pinForm input[name="pinConfirm"]').required = false;
  $('#pinForm').reset();
  showOnly('pinView');
}

function readPinFailures() {
  return readJson(userKey(PIN_FAILURES_PREFIX)) || { count: 0, blockedUntil: 0 };
}

function savePinFailures(value) {
  writeJson(userKey(PIN_FAILURES_PREFIX), value);
}

async function handlePinSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const pin = String(data.get('pin') || '');
  const confirmPin = String(data.get('pinConfirm') || '');
  if (!/^\d{4,8}$/.test(pin)) return toast('El PIN debe tener entre 4 y 8 números.');

  if (state.pinMode === 'setup') {
    if (pin !== confirmPin) return toast('Los PIN no coinciden.');
    localStorage.setItem(pinKey(), await sha256(pin));
    savePinFailures({ count: 0, blockedUntil: 0 });
    state.unlocked = true;
    enterApp();
    return;
  }

  const failures = readPinFailures();
  if (failures.blockedUntil > Date.now()) return toast(`Espera ${humanDuration(failures.blockedUntil - Date.now())} antes de intentar otra vez.`);
  const hash = await sha256(pin);
  if (hash !== localStorage.getItem(pinKey())) {
    const count = failures.count + 1;
    const blockedUntil = count >= 5 ? Date.now() + 5 * 60000 : 0;
    savePinFailures({ count: blockedUntil ? 0 : count, blockedUntil });
    return toast(blockedUntil ? 'Demasiados intentos. Bloqueado durante 5 minutos.' : 'PIN incorrecto.');
  }
  savePinFailures({ count: 0, blockedUntil: 0 });
  state.unlocked = true;
  enterApp();
}

async function validateAdminOnline() {
  await state.user.getIdToken(true);
  if (!localStorage.getItem(ADMIN_DEVICE_NAME_KEY)) localStorage.setItem(ADMIN_DEVICE_NAME_KEY, defaultDeviceName());
  state.actor = { id: state.user.uid, name: 'Administrador', role: 'admin', email: state.user.email || '' };
  state.device = { deviceName: currentDeviceName(), offlineHours: 168, active: true, role: 'admin' };
  storeLease();
}

async function evaluateAccess({ forceServer = false } = {}) {
  if (!state.user) {
    showOnly('accessView');
    return;
  }
  updateConnectionUi();
  state.lease = readJson(leaseKey());

  if (state.admin) {
    let validated = false;
    if (navigator.onLine || forceServer) {
      try {
        await validateAdminOnline();
        validated = true;
      } catch (error) {
        console.warn('No se pudo validar al administrador', error);
      }
    }
    if (!validated && leaseRemaining() <= 0) {
      return showBlocked('El permiso offline del administrador venció.', 'Conecta esta PC a internet e inicia sesión nuevamente para renovar los 7 días.');
    }
    if (!state.actor) {
      state.actor = { id: state.user.uid, name: 'Administrador', role: 'admin', email: state.user.email || '' };
      state.device = { deviceName: currentDeviceName(), offlineHours: 168, active: true, role: 'admin' };
    }
    return localStorage.getItem(pinKey()) ? showPinUnlock() : showPinSetup();
  }

  const deviceRef = doc(db, 'devices', state.user.uid);
  let snapshot = null;
  let serverValidated = false;
  if (navigator.onLine || forceServer) {
    try {
      snapshot = await getDocFromServer(deviceRef);
      serverValidated = true;
    } catch (error) {
      console.warn('Validación del dispositivo no disponible', error);
    }
  }
  if (!snapshot) {
    try { snapshot = await getDoc(deviceRef); } catch (error) { console.warn(error); }
  }

  if (snapshot?.exists()) {
    state.device = { id: snapshot.id, ...snapshot.data() };
    state.actor = { id: state.user.uid, name: state.device.userName || 'Operador', role: 'operator' };
    localStorage.setItem(actorNameKey(), state.actor.name);
    if (!state.device.active) {
      clearLocalAccess();
      return showBlocked('Este dispositivo fue revocado.', 'El administrador debe reactivarlo o autorizar una nueva instalación.');
    }
    if (serverValidated) {
      storeLease();
      updateDoc(deviceRef, { lastSeenAt: serverTimestamp(), appVersion: APP_VERSION }).catch(console.warn);
    } else if (leaseRemaining() <= 0) {
      return showBlocked('El permiso offline venció.', `Conecta este dispositivo a internet para renovar su acceso de ${leaseHours()} horas.`);
    }
    watchOwnDevice();
    return localStorage.getItem(pinKey()) ? showPinUnlock() : showPinSetup();
  }

  state.device = null;
  state.actor = null;
  if (!navigator.onLine) return showBlocked('No se pudo comprobar el dispositivo.', 'Conéctalo a internet para enviar o confirmar una solicitud.');

  let requestSnapshot = null;
  try { requestSnapshot = await getDocFromServer(doc(db, 'deviceRequests', state.user.uid)); } catch { /* sin solicitud */ }
  if (requestSnapshot?.exists()) {
    const request = { id: requestSnapshot.id, ...requestSnapshot.data() };
    if (request.status === 'pending' || request.status === 'key_issued') return showPendingRequest(request);
    if (request.status === 'activated') return evaluateAccess({ forceServer: true });
  }
  showRequestForm();
}

function watchOwnDevice() {
  state.accessUnsub?.();
  if (state.admin || !state.user) return;
  state.accessUnsub = onSnapshot(doc(db, 'devices', state.user.uid), snapshot => {
    if (!snapshot.exists()) return;
    const device = { id: snapshot.id, ...snapshot.data() };
    if (!device.active) {
      clearLocalAccess();
      showBlocked('Este dispositivo fue revocado.', 'El administrador desactivó esta instalación.');
      return;
    }
    if (!state.device || state.device.active !== device.active) evaluateAccess({ forceServer: true });
  }, error => console.warn('Escucha de dispositivo', error));
}

async function submitDeviceRequest(event) {
  event.preventDefault();
  if (!state.user?.isAnonymous) return toast('La solicitud debe hacerse desde una identidad de dispositivo.');
  if (!navigator.onLine) return toast('Conéctate para enviar la solicitud.');
  const data = new FormData(event.currentTarget);
  const userName = String(data.get('userName') || '').trim();
  const deviceName = String(data.get('deviceName') || '').trim();
  if (!userName || !deviceName) return toast('Completa el nombre y el dispositivo.');
  localStorage.setItem(actorNameKey(), userName);
  const whatsappWindow = window.open('', '_blank');
  try {
    await setDoc(doc(db, 'deviceRequests', state.user.uid), {
      uid: state.user.uid,
      userName,
      deviceName,
      appVersion: APP_VERSION,
      status: 'pending',
      createdAt: serverTimestamp()
    });
  } catch (error) {
    whatsappWindow?.close();
    throw error;
  }
  const request = { uid: state.user.uid, userName, deviceName, status: 'pending' };
  state.request = request;
  showPendingRequest(request);
  const url = accessWhatsAppUrl(request);
  if (whatsappWindow) whatsappWindow.location.href = url;
}


async function activateWithTemporaryKey(event) {
  event.preventDefault();
  if (!state.user?.isAnonymous) return toast('Esta clave debe usarse desde la instalación que hizo la solicitud.');
  if (!navigator.onLine) return toast('Conéctate para validar la clave temporal.');
  const data = new FormData(event.currentTarget);
  const plainKey = normalizeActivationKey(data.get('activationKey'));
  if (plainKey.length !== 12) return toast('La clave temporal no tiene el formato correcto.');
  const keyHash = await sha256(plainKey);
  const keyRef = doc(db, 'activationKeys', keyHash);
  const deviceRef = doc(db, 'devices', state.user.uid);
  const requestRef = doc(db, 'deviceRequests', state.user.uid);

  try {
    const outcome = await runTransaction(db, async transaction => {
      const keySnap = await transaction.get(keyRef);
      if (!keySnap.exists()) throw new Error('La clave es incorrecta o no corresponde a este dispositivo.');
      const keyData = keySnap.data();
      if (keyData.targetUid !== state.user.uid) throw new Error('La clave pertenece a otra instalación.');
      if (keyData.used) throw new Error('Esta clave ya fue utilizada.');
      const expiresAtMs = keyData.expiresAt?.toMillis?.() || 0;
      if (!expiresAtMs || expiresAtMs <= Date.now()) throw new Error('La clave temporal venció. Solicita una nueva.');

      const deviceSnap = await transaction.get(deviceRef);
      const requestSnap = await transaction.get(requestRef);
      if (keyData.mode === 'recovery') {
        if (!deviceSnap.exists() || !deviceSnap.data().active) throw new Error('El dispositivo no está activo para recuperar el acceso.');
        transaction.update(deviceRef, { lastSeenAt: serverTimestamp(), appVersion: APP_VERSION });
      } else {
        transaction.set(deviceRef, {
          uid: state.user.uid,
          userName: keyData.userName || 'Operador',
          deviceName: keyData.deviceName || defaultDeviceName(),
          active: true,
          role: 'operator',
          offlineHours: Number(keyData.offlineHours || 24),
          appVersion: APP_VERSION,
          activationKeyHash: keyHash,
          authorizedAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
          authorizedBy: keyData.createdBy || ADMIN_UID
        });
        if (requestSnap.exists()) {
          transaction.update(requestRef, {
            status: 'activated',
            activatedAt: serverTimestamp(),
            activationKeyHash: keyHash
          });
        }
      }

      transaction.update(keyRef, {
        used: true,
        usedAt: serverTimestamp(),
        usedByUid: state.user.uid
      });
      return { mode: keyData.mode || 'activation' };
    });

    clearLocalAccess();
    toast(outcome.mode === 'recovery' ? 'Acceso recuperado. Crea un PIN nuevo.' : 'Dispositivo activado. Crea tu PIN.');
    await evaluateAccess({ forceServer: true });
  } catch (error) {
    const message = error?.code === 'permission-denied' ? 'La clave es incorrecta, venció o pertenece a otra instalación.' : (error.message || 'No se pudo utilizar la clave.');
    toast(message);
  }
}

function startLeaseTimer() {
  clearInterval(state.leaseTimer);
  state.leaseTimer = setInterval(async () => {
    if (!state.unlocked || !state.user) return;
    if (!navigator.onLine && leaseRemaining() <= 0) {
      state.unlocked = false;
      stopDataSync();
      showBlocked('El permiso offline venció.', 'Conecta el dispositivo para renovar la autorización.');
    }
    updateLeaseUi();
  }, 30000);
}

function updateLeaseUi() {
  const remaining = leaseRemaining();
  const text = navigator.onLine ? `Permiso offline: ${humanDuration(remaining)}` : `Offline restante: ${humanDuration(remaining)}`;
  $('#leaseState').textContent = text;
}

async function writeAudit(action, details = {}) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, 'audit'), {
      uid: state.user.uid,
      actorName: state.actor?.name || '',
      deviceId: currentDeviceId(),
      deviceName: currentDeviceName(),
      action,
      details,
      createdAt: serverTimestamp(),
      createdAtIso: now()
    });
  } catch (error) {
    console.warn('Auditoría no disponible', error);
  }
}

function stopDataSync() {
  state.dataUnsubs.forEach(unsub => {
    try { unsub(); } catch { /* no-op */ }
  });
  state.dataUnsubs = [];
  state.collectionLoaded.clear();
}

function startDataSync() {
  if (state.dataUnsubs.length) return;
  for (const collectionName of ENTITY_COLLECTIONS) {
    const unsub = onSnapshot(
      collection(db, collectionName),
      { includeMetadataChanges: true },
      snapshot => {
        state.data[collectionName] = snapshot.docs.map(item => ({ id: item.id, ...item.data(), _pending: item.metadata.hasPendingWrites }));
        state.pendingByCollection[collectionName] = snapshot.docs.filter(item => item.metadata.hasPendingWrites).length;
        state.collectionLoaded.add(collectionName);
        state.data.updatedAt = now();
        updateSyncUi();
        renderAll();
      },
      error => {
        console.error(`Sincronización ${collectionName}`, error);
        $('#storageBadge').textContent = 'Error de sincronización';
        $('#storageBadge').className = 'sync-badge error';
        if (String(error.code || '').includes('permission-denied')) {
          state.unlocked = false;
          stopDataSync();
          showBlocked('Firebase rechazó el acceso.', 'El dispositivo pudo haber sido revocado o las reglas deben actualizarse.');
        }
      }
    );
    state.dataUnsubs.push(unsub);
  }
}

function pendingWriteCount() {
  return Object.values(state.pendingByCollection).reduce((sum, value) => sum + Number(value || 0), 0);
}

function updateSyncUi() {
  const badge = $('#storageBadge');
  if (!badge) return;
  const pending = pendingWriteCount();
  if (!navigator.onLine) {
    badge.textContent = pending ? `Sin conexión · ${pending} pendiente${pending === 1 ? '' : 's'}` : 'Sin conexión';
    badge.className = 'sync-badge offline';
  } else if (pending) {
    badge.textContent = `Sincronizando · ${pending}`;
    badge.className = 'sync-badge pending';
  } else if (state.collectionLoaded.size < ENTITY_COLLECTIONS.length) {
    badge.textContent = 'Cargando datos…';
    badge.className = 'sync-badge syncing';
  } else {
    badge.textContent = 'Todo sincronizado';
    badge.className = 'sync-badge';
  }
}

function actorFields(existing = null) {
  const stamp = now();
  const base = {
    updatedAt: stamp,
    updatedByUid: state.user.uid,
    updatedByName: state.actor?.name || '',
    updatedByDevice: currentDeviceName(),
    serverUpdatedAt: serverTimestamp()
  };
  if (!existing?.createdByUid) {
    base.createdAt = existing?.createdAt || stamp;
    base.createdByUid = state.user.uid;
    base.createdByName = state.actor?.name || '';
    base.createdByDevice = currentDeviceName();
    base.serverCreatedAt = serverTimestamp();
  }
  return base;
}

async function saveEntity(collectionName, entity, message = '', auditAction = '') {
  if (!state.unlocked || !state.user) return toast('El dispositivo no está desbloqueado.');
  const clean = { ...entity };
  delete clean._pending;
  Object.assign(clean, actorFields(entity));
  try {
    await setDoc(doc(db, collectionName, clean.id), clean, { merge: true });
    if (message) toast(message);
    if (auditAction) writeAudit(auditAction, { collection: collectionName, id: clean.id });
  } catch (error) {
    console.error(error);
    toast(error.code === 'permission-denied' ? 'Firebase rechazó la operación.' : `No se pudo guardar: ${error.message}`);
  }
}

async function saveManyFromData(data, message = 'Datos importados.') {
  const groups = [
    ['campaigns', Array.isArray(data.campaigns) ? data.campaigns : []],
    ['sales', Array.isArray(data.sales) ? data.sales : []],
    ['results', Array.isArray(data.results) ? data.results : []],
    ['deliveries', Array.isArray(data.deliveries) ? data.deliveries : []]
  ];
  const operations = groups.flatMap(([name, items]) => items.map(item => ({ name, item })));
  if (!operations.length) return toast('El archivo no contiene registros para importar.');
  let completed = 0;
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(index, index + 400)) {
      const id = operation.item.id || makeId(operation.name.slice(0, -1));
      const existing = { ...operation.item, id };
      delete existing._pending;
      const payload = { ...existing, ...actorFields(existing) };
      batch.set(doc(db, operation.name, id), payload, { merge: true });
      completed += 1;
    }
    await batch.commit();
  }
  writeAudit('data.imported', { count: completed });
  toast(`${message} ${completed} registros procesados.`);
}

function visibleSales() {
  return state.data.sales.filter(sale => !sale.deleted);
}

function visibleCampaigns() {
  return state.data.campaigns.filter(campaign => !campaign.deleted);
}

function activeCampaigns() {
  return visibleCampaigns().filter(campaign => campaign.status === 'active');
}

function getCampaign(campaignId) {
  return state.data.campaigns.find(campaign => campaign.id === campaignId && !campaign.deleted) || null;
}

function numberForCampaign(value, campaign) {
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(numeric)) throw new Error('El número no es válido.');
  if (numeric < Number(campaign.numberMin) || numeric > Number(campaign.numberMax)) {
    throw new Error(`El número debe estar entre ${campaign.numberMin} y ${campaign.numberMax}.`);
  }
  return String(numeric).padStart(Number(campaign.numberWidth || 1), '0');
}

function showView(viewName) {
  if (!isAdmin() && viewName === 'devices') viewName = 'dashboard';
  state.activeView = viewName;
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));
  $$('#nav button').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
  $('#sidebar').classList.remove('open');
  if (viewName === 'result') renderWinnerSummary();
  if (viewName === 'sales') renderSales();
  if (viewName === 'devices' && isAdmin()) refreshDevices();
}

function populateCampaignSelect(select, { includeAll = false, activeOnly = false } = {}) {
  const previous = select.value;
  const campaigns = activeOnly ? activeCampaigns() : visibleCampaigns();
  const options = [];
  if (includeAll) options.push('<option value="all">Todas las campañas</option>');
  options.push(...campaigns.map(campaign => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)}</option>`));
  if (!campaigns.length && !includeAll) options.push('<option value="">No hay campañas disponibles</option>');
  select.innerHTML = options.join('');
  if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
}

function renderAll() {
  if (!state.unlocked || !state.actor) return;
  $('#userName').textContent = state.actor.name;
  $('#userRole').textContent = isAdmin() ? 'Administrador · 7 días offline' : `${currentDeviceName()} · ${leaseHours()} h offline`;
  $('#userAvatar').textContent = state.actor.name.trim().charAt(0).toUpperCase() || 'U';
  $$('[data-admin-only]').forEach(element => element.classList.toggle('hidden', !isAdmin()));

  const active = activeCampaigns()[0];
  $('#activeCampaignLabel').textContent = active ? active.name : 'Sin campaña activa';
  populateCampaignSelect($('#dashboardCampaignFilter'), { includeAll: true });
  populateCampaignSelect($('#salesCampaignFilter'), { includeAll: true });
  populateCampaignSelect($('#saleForm select[name="campaignId"]'), { activeOnly: true });
  populateCampaignSelect($('#resultForm select[name="campaignId"]'));

  renderDashboard();
  renderSales();
  renderCampaigns();
  renderWinnerSummary();
  updateConnectionUi();
  updateLeaseUi();
  $('#legacyMigrationPanel').classList.toggle('hidden', !localStorage.getItem(LEGACY_STORAGE_KEY));
  if (!isAdmin() && state.activeView === 'devices') showView('dashboard');
}

function renderDashboard() {
  const filter = $('#dashboardCampaignFilter').value || 'all';
  const sales = visibleSales().filter(sale => filter === 'all' || sale.campaignId === filter);
  const valid = sales.filter(sale => sale.paymentStatus !== 'cancelled');
  const paid = valid.filter(sale => sale.paymentStatus === 'paid');
  const pending = valid.filter(sale => sale.paymentStatus === 'pending');
  const totalAmount = paid.reduce((sum, sale) => sum + Number(sale.amount || 0), 0);
  const participationCount = valid.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0);

  $('#metrics').innerHTML = [
    ['Ventas', valid.length, 'registros activos'],
    ['Participaciones', participationCount, 'cantidad total'],
    ['Cobrado', formatAmount(totalAmount), 'ventas pagadas'],
    ['Pendientes', pending.length, 'ventas sin pagar']
  ].map(([label, value, note]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');

  const recent = [...sales].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 8);
  $('#recentSales').innerHTML = recent.length ? recent.map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return `<div class="list-item"><div><strong>${escapeHtml(sale.customerName)}</strong><small>${escapeHtml(campaign?.name || 'Campaña')} · Número ${escapeHtml(sale.number)} · ${escapeHtml(sale.sellerName || sale.createdByName || 'Usuario')}</small></div><div><span class="status-pill ${sale.paymentStatus}">${paymentLabel(sale.paymentStatus)}</span><small>${sale._pending ? '<span class="pending-dot"></span>Pendiente' : '<span class="server-dot"></span>Confirmado'}</small></div></div>`;
  }).join('') : '<div class="empty">Todavía no hay ventas registradas.</div>';

  $('#localSummary').innerHTML = `
    <div class="sync-line"><span>Cuenta</span><strong>${escapeHtml(state.actor.name)}</strong></div>
    <div class="sync-line"><span>Dispositivo</span><strong>${escapeHtml(currentDeviceName())}</strong></div>
    <div class="sync-line"><span>Sincronización</span><strong>${pendingWriteCount() ? `${pendingWriteCount()} pendiente(s)` : 'Confirmada'}</strong></div>
    <div class="sync-line"><span>Conexión actual</span><strong>${navigator.onLine ? 'En línea' : 'Sin conexión'}</strong></div>
    <div class="sync-line"><span>Permiso restante</span><strong>${humanDuration(leaseRemaining())}</strong></div>`;
}

function renderCampaigns() {
  const container = $('#campaignList');
  const campaigns = visibleCampaigns().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  if (!campaigns.length) {
    container.innerHTML = '<div class="panel empty">Crea la primera campaña para registrar ventas.</div>';
    return;
  }
  container.innerHTML = campaigns.map(campaign => {
    const saleCount = state.data.sales.filter(sale => !sale.deleted && sale.campaignId === campaign.id && sale.paymentStatus !== 'cancelled').length;
    return `<article class="campaign-card">
      <header><div><h3>${escapeHtml(campaign.name)}</h3><span class="status-pill ${campaign.status === 'active' ? 'paid' : 'cancelled'}">${campaignStatusLabel(campaign.status)}</span></div><strong>${campaign.numberMin}–${campaign.numberMax}</strong></header>
      <div class="campaign-meta">
        <span class="meta-chip">${saleCount} ventas</span>
        <span class="meta-chip">${campaign.allowRepeated ? 'Números repetidos' : 'Números exclusivos'}</span>
        <span class="meta-chip">${campaign.eligibility === 'paid' ? 'Solo pagados' : 'Pagados y pendientes'}</span>
        ${campaign._pending ? '<span class="meta-chip">Pendiente de sincronizar</span>' : ''}
      </div>
      ${campaign.notes ? `<p class="muted">${escapeHtml(campaign.notes)}</p>` : ''}
      <div class="card-actions">
        <button class="secondary" data-campaign-toggle="${campaign.id}">${campaign.status === 'active' ? 'Cerrar campaña' : 'Activar campaña'}</button>
        <button class="danger" data-campaign-delete="${campaign.id}" ${saleCount ? 'disabled title="No se puede eliminar una campaña con ventas"' : ''}>Eliminar</button>
      </div>
    </article>`;
  }).join('');
}

function filteredSales() {
  const campaignFilter = $('#salesCampaignFilter').value || 'all';
  const statusFilter = $('#salesStatusFilter').value || 'all';
  const searchText = normalizeText($('#salesSearch').value);
  return visibleSales().filter(sale => {
    if (campaignFilter !== 'all' && sale.campaignId !== campaignFilter) return false;
    if (statusFilter !== 'all' && sale.paymentStatus !== statusFilter) return false;
    if (searchText) {
      const haystack = normalizeText([sale.number, sale.customerName, sale.phone, sale.sellerName, sale.createdByName].join(' '));
      if (!haystack.includes(searchText)) return false;
    }
    return true;
  }).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

function renderSales() {
  const sales = filteredSales();
  const header = '<div class="table-row header"><span>Número</span><span>Cliente</span><span>Teléfono</span><span>Cantidad</span><span>Monto</span><span>Estado</span><span>Acción</span></div>';
  const rows = sales.map(sale => `<div class="table-row">
    <span><span class="number-chip">${escapeHtml(sale.number)}</span></span>
    <span><strong>${escapeHtml(sale.customerName)}</strong><small>${escapeHtml(sale.sellerName || sale.createdByName || 'Usuario')} · ${formatDate(sale.createdAt)} ${sale._pending ? '· Pendiente' : ''}</small></span>
    <span>${escapeHtml(sale.phone || '—')}</span>
    <span>${Number(sale.quantity || 0)}</span>
    <span>${formatAmount(sale.amount)}</span>
    <span><span class="status-pill ${sale.paymentStatus}">${paymentLabel(sale.paymentStatus)}</span></span>
    <span class="table-actions"><button data-edit-sale="${sale.id}" title="Editar">✎</button></span>
  </div>`).join('');
  $('#salesTable').innerHTML = sales.length ? header + rows : '<div class="empty">No hay ventas con esos filtros.</div>';
}

function currentResult() {
  const campaignId = $('#resultForm select[name="campaignId"]').value;
  return state.data.results.find(result => !result.deleted && result.campaignId === campaignId) || null;
}

function winnerGroups(result) {
  if (!result) return [];
  const campaign = getCampaign(result.campaignId);
  if (!campaign) return [];
  const eligibleStatuses = campaign.eligibility === 'paid' ? ['paid'] : ['paid', 'pending'];
  const matched = state.data.sales.filter(sale => !sale.deleted && sale.campaignId === campaign.id && sale.number === result.winningNumber && eligibleStatuses.includes(sale.paymentStatus));
  const groups = new Map();
  for (const sale of matched) {
    const phone = normalizePhone(sale.phone);
    const key = phone ? `phone:${phone}` : `name:${normalizeText(sale.customerName)}`;
    const existing = groups.get(key) || { key, customerName: sale.customerName, phone: sale.phone, quantity: 0, amount: 0, sellers: new Set(), sales: [] };
    existing.quantity += Number(sale.quantity || 0);
    existing.amount += Number(sale.amount || 0);
    existing.sellers.add(sale.sellerName || sale.createdByName || 'Usuario');
    existing.sales.push(sale);
    if (!existing.phone && sale.phone) existing.phone = sale.phone;
    groups.set(key, existing);
  }
  return Array.from(groups.values()).map(group => ({ ...group, sellers: Array.from(group.sellers) }));
}

function deliveryFor(resultId, groupKey) {
  return state.data.deliveries.find(delivery => !delivery.deleted && delivery.resultId === resultId && delivery.groupKey === groupKey) || null;
}

function renderWinnerSummary() {
  const campaign = getCampaign($('#resultForm select[name="campaignId"]').value);
  const result = currentResult();
  const container = $('#winnerSummary');
  if (!campaign) {
    container.innerHTML = '<div class="panel empty">Crea una campaña para consultar coincidencias.</div>';
    return;
  }
  if (!result) {
    container.innerHTML = '<div class="panel empty">Escribe un número para buscar coincidencias en esta campaña.</div>';
    return;
  }
  const groups = winnerGroups(result);
  const totalParticipations = groups.reduce((sum, group) => sum + group.quantity, 0);
  const pendingDeliveries = groups.filter(group => !deliveryFor(result.id, group.key)?.delivered).length;
  const cards = groups.map(group => {
    const delivery = deliveryFor(result.id, group.key);
    return `<article class="winner-card">
      <header><div><h3>${escapeHtml(group.customerName)}</h3><span class="status-pill ${delivery?.delivered ? 'delivered' : 'pending'}">${delivery?.delivered ? 'Entregado' : 'Pendiente'}</span></div><span class="number-chip">${escapeHtml(result.winningNumber)}</span></header>
      <div class="winner-details">
        <div><span>Teléfono</span><strong>${escapeHtml(group.phone || '—')}</strong></div>
        <div><span>Participaciones</span><strong>${group.quantity}</strong></div>
        <div><span>Registrado por</span><strong>${escapeHtml(group.sellers.join(', '))}</strong></div>
        <div><span>Monto registrado</span><strong>${formatAmount(group.amount)}</strong></div>
      </div>
      <div class="card-actions"><button class="${delivery?.delivered ? 'ghost' : 'primary'}" data-delivery-key="${escapeHtml(group.key)}" data-result-id="${result.id}">${delivery?.delivered ? 'Marcar pendiente' : 'Marcar entregado'}</button></div>
    </article>`;
  }).join('');
  container.innerHTML = `
    <div class="winner-overview">
      <article class="winner-stat"><span>Número consultado</span><strong>${escapeHtml(result.winningNumber)}</strong></article>
      <article class="winner-stat"><span>Personas coincidentes</span><strong>${groups.length}</strong></article>
      <article class="winner-stat"><span>Entregas pendientes</span><strong>${pendingDeliveries}</strong></article>
    </div>
    <article class="panel"><p><strong>Total de participaciones coincidentes:</strong> ${totalParticipations}</p>${result.notes ? `<p class="muted">${escapeHtml(result.notes)}</p>` : ''}</article>
    <div class="winner-list">${cards || '<div class="panel empty">No hay registros elegibles con ese número.</div>'}</div>`;
}

function download(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function cleanExportItem(item) {
  const copy = { ...item };
  delete copy._pending;
  delete copy.serverCreatedAt;
  delete copy.serverUpdatedAt;
  return copy;
}

function exportJson() {
  const data = {
    version: 2,
    exportedAt: now(),
    campaigns: state.data.campaigns.map(cleanExportItem),
    sales: state.data.sales.map(cleanExportItem),
    results: state.data.results.map(cleanExportItem),
    deliveries: state.data.deliveries.map(cleanExportItem)
  };
  const stamp = new Date().toISOString().slice(0, 10);
  download(`numina-respaldo-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const headers = ['Fecha', 'Campaña', 'Número', 'Cliente', 'Teléfono', 'Participaciones', 'Monto', 'Estado', 'Registrado por', 'Sincronización', 'Notas'];
  const rows = visibleSales().map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return [
      sale.createdAt,
      campaign?.name || '',
      sale.number,
      sale.customerName,
      sale.phone,
      sale.quantity,
      sale.amount,
      paymentLabel(sale.paymentStatus),
      sale.sellerName || sale.createdByName || '',
      sale._pending ? 'Pendiente' : 'Confirmada',
      sale.notes
    ].map(csvCell).join(',');
  });
  const stamp = new Date().toISOString().slice(0, 10);
  download(`numina-ventas-${stamp}.csv`, '\ufeff' + [headers.map(csvCell).join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
}

function printView(viewName) {
  const view = $(`#view-${viewName}`);
  $$('.view').forEach(element => element.classList.remove('print-target'));
  view.classList.add('print-target');
  window.print();
  setTimeout(() => view.classList.remove('print-target'), 500);
}

function refreshInstallButtons() {
  const show = Boolean(state.deferredInstallPrompt);
  ['#installBtn', '#installAccessBtn', '#installBackupBtn'].forEach(selector => $(selector)?.classList.toggle('hidden', !show));
}

async function requestInstall() {
  if (!state.deferredInstallPrompt) {
    toast('En Chrome o Edge, abre el menú y elige “Instalar aplicación” o “Agregar a pantalla principal”.');
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  refreshInstallButtons();
}

async function enterApp() {
  if (!state.unlocked || !state.actor) return;
  showOnly('appView');
  startDataSync();
  startLeaseTimer();
  renderAll();
  if (isAdmin()) refreshDevices();
}

async function refreshDevices() {
  if (!isAdmin()) return;
  if (!navigator.onLine) {
    $('#requestList').innerHTML = '<div class="empty">Conéctate para administrar solicitudes.</div>';
    $('#deviceList').innerHTML = '<div class="empty">La revocación requiere conexión.</div>';
    return;
  }
  try {
    const [requestsSnap, devicesSnap] = await Promise.all([
      getDocs(query(collection(db, 'deviceRequests'), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, 'devices'), orderBy('authorizedAt', 'desc')))
    ]);
    const requests = requestsSnap.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => ['pending', 'key_issued'].includes(item.status));
    const devices = devicesSnap.docs.map(item => ({ id: item.id, ...item.data() }));
    renderRequests(requests);
    renderDevices(devices);
  } catch (error) {
    console.error(error);
    $('#requestList').innerHTML = `<div class="empty">No se pudieron cargar solicitudes: ${escapeHtml(error.message)}</div>`;
    $('#deviceList').innerHTML = '<div class="empty">Revisa que las reglas nuevas de Firestore estén publicadas.</div>';
  }
}

function renderRequests(requests) {
  $('#requestList').innerHTML = requests.length ? requests.map(request => {
    const issued = request.status === 'key_issued';
    return `<article class="record-card">
    <header><div><strong>${escapeHtml(request.userName || 'Usuario')}</strong><span>${escapeHtml(request.deviceName || 'Dispositivo')}</span></div><span class="status-pill requested">${issued ? 'Clave generada' : 'Pendiente'}</span></header>
    <small>Código ${escapeHtml(request.id.slice(0, 8).toUpperCase())} · ${formatDate(request.createdAt)}</small>
    <div class="card-actions"><button class="primary" data-generate-key="${escapeHtml(request.id)}" type="button">${issued ? 'Generar otra clave' : 'Generar clave'}</button><button class="danger" data-reject="${escapeHtml(request.id)}" type="button">Rechazar</button></div>
  </article>`;
  }).join('') : '<div class="empty">No hay solicitudes pendientes.</div>';
}

function renderDevices(devices) {
  $('#deviceList').innerHTML = devices.length ? devices.map(device => `<article class="record-card">
    <header><div><strong>${escapeHtml(device.userName || 'Usuario')}</strong><span>${escapeHtml(device.deviceName || 'Dispositivo')}</span></div><span class="status-pill ${device.active ? 'active' : 'revoked'}">${device.active ? 'Activo' : 'Revocado'}</span></header>
    <small>Offline ${Number(device.offlineHours || 24)} h · ID ${escapeHtml(device.id.slice(0, 8).toUpperCase())} · Último acceso ${formatDate(device.lastSeenAt)}</small>
    <div class="card-actions">${device.active ? `<button class="secondary" data-recovery-key="${escapeHtml(device.id)}" type="button">Nueva clave</button>` : ''}<button class="${device.active ? 'danger' : 'secondary'}" data-toggle-device="${escapeHtml(device.id)}" data-active="${device.active ? '1' : '0'}" type="button">${device.active ? 'Revocar' : 'Reactivar'}</button></div>
  </article>`).join('') : '<div class="empty">No hay dispositivos autorizados.</div>';
}

async function createTemporaryKey(targetUid, userName, deviceName, offlineHours, expiresMinutes, mode = 'activation') {
  if (!navigator.onLine) throw new Error('Conéctate para generar la clave.');
  const plainKey = generateActivationKey();
  const normalized = normalizeActivationKey(plainKey);
  const keyHash = await sha256(normalized);
  const expiresAt = Timestamp.fromMillis(Date.now() + Number(expiresMinutes) * 60000);
  const batch = writeBatch(db);
  batch.set(doc(db, 'activationKeys', keyHash), {
    targetUid,
    userName: userName.trim(),
    deviceName: deviceName.trim(),
    mode,
    offlineHours: Number(offlineHours),
    expiresAt,
    keySuffix: normalized.slice(-4),
    used: false,
    createdAt: serverTimestamp(),
    createdBy: state.user.uid
  });
  if (mode === 'activation') {
    batch.update(doc(db, 'deviceRequests', targetUid), {
      status: 'key_issued',
      keyIssuedAt: serverTimestamp(),
      keyExpiresAt: expiresAt
    });
  }
  await batch.commit();
  await writeAudit(mode === 'recovery' ? 'device.recoveryKeyCreated' : 'device.activationKeyCreated', { targetUid, userName, deviceName, offlineHours: Number(offlineHours), expiresMinutes: Number(expiresMinutes) });
  return { plainKey, expiresAt, userName, deviceName, expiresMinutes: Number(expiresMinutes), mode };
}

function showGeneratedKey(result) {
  state.generatedKey = result;
  $('#generatedKeyOutput').textContent = result.plainKey;
  $('#keyResultMessage').textContent = `${result.mode === 'recovery' ? 'Recuperación para' : 'Activación para'} ${result.userName} · ${result.deviceName}. Vence en ${result.expiresMinutes} minutos.`;
  $('#shareGeneratedKeyBtn').href = activationKeyWhatsAppUrl(result.plainKey, result.userName, result.deviceName, result.expiresMinutes);
  $('#keyResultDialog').showModal();
}

async function rejectRequest(requestId) {
  await updateDoc(doc(db, 'deviceRequests', requestId), {
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectedBy: state.user.uid
  });
  await writeAudit('device.requestRejected', { targetUid: requestId });
}

async function toggleDevice(deviceId, active) {
  await updateDoc(doc(db, 'devices', deviceId), {
    active: !active,
    statusChangedAt: serverTimestamp(),
    statusChangedBy: state.user.uid
  });
  await writeAudit(active ? 'device.revoked' : 'device.reactivated', { targetUid: deviceId });
}

async function migrateLegacyData() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return toast('No se encontraron datos anteriores.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return toast('Los datos anteriores no se pudieron leer.'); }
  if (!confirm('¿Copiar a Firebase las campañas y registros de la versión anterior?')) return;
  try {
    await saveManyFromData(parsed, 'Migración completada.');
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    $('#legacyMigrationPanel').classList.add('hidden');
  } catch (error) {
    toast(`No se pudo migrar: ${error.message}`);
  }
}

async function changeAccount() {
  if (!state.admin && state.user?.isAnonymous) {
    const proceed = confirm('Cerrar esta sesión desvinculará esta instalación. Para volver a entrar necesitarás una nueva autorización. ¿Continuar?');
    if (!proceed) return;
  }
  await signOut(auth);
}

async function renewAccessSilently() {
  if (!state.user || !navigator.onLine) return;
  try {
    if (state.admin) {
      await validateAdminOnline();
    } else {
      const snapshot = await getDocFromServer(doc(db, 'devices', state.user.uid));
      if (!snapshot.exists() || !snapshot.data().active) {
        clearLocalAccess();
        stopDataSync();
        return showBlocked('Este dispositivo fue revocado.', 'El administrador desactivó esta instalación.');
      }
      state.device = { id: snapshot.id, ...snapshot.data() };
      state.actor = { id: state.user.uid, name: state.device.userName || 'Operador', role: 'operator' };
      storeLease();
      updateDoc(doc(db, 'devices', state.user.uid), { lastSeenAt: serverTimestamp(), appVersion: APP_VERSION }).catch(console.warn);
    }
    updateLeaseUi();
    updateSyncUi();
  } catch (error) {
    console.warn('Renovación silenciosa', error);
  }
}

$('#adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#loginError').textContent = '';
  const data = new FormData(event.currentTarget);
  try {
    if (auth.currentUser) await signOut(auth);
    await signInWithEmailAndPassword(auth, String(data.get('email')).trim(), String(data.get('password')));
  } catch (error) {
    $('#loginError').textContent = authErrorMessage(error);
  }
});

$('#togglePasswordBtn').addEventListener('click', () => {
  const input = $('#adminLoginForm input[name="password"]');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#togglePasswordBtn').textContent = input.type === 'password' ? 'Ver' : 'Ocultar';
});

$('#resetPasswordBtn').addEventListener('click', async () => {
  const email = $('#adminLoginForm input[name="email"]').value.trim();
  if (!email) return toast('Escribe primero el correo.');
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Firebase envió el correo de recuperación.');
  } catch (error) {
    toast(authErrorMessage(error));
  }
});

$('#startRequestBtn')?.addEventListener('click', async () => {
  if (!navigator.onLine) return toast('Conéctate para crear la solicitud inicial.');
  try {
    if (auth.currentUser) await signOut(auth);
    await signInAnonymously(auth);
  } catch (error) {
    toast(authErrorMessage(error));
  }
});

$('#enterKeyBtn')?.addEventListener('click', async () => {
  if (!navigator.onLine) return toast('Conéctate para validar una clave temporal.');
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    if (!state.request) {
      try {
        const snap = await getDocFromServer(doc(db, 'deviceRequests', auth.currentUser.uid));
        if (snap.exists()) state.request = { id: snap.id, ...snap.data() };
      } catch { /* se mostrará el formulario de solicitud */ }
    }
    if (state.request) showActivationForm();
    else showRequestForm();
  } catch (error) { toast(authErrorMessage(error)); }
});
$('#requestForm')?.addEventListener('submit', event => submitDeviceRequest(event).catch(error => toast(error.message)));
$('#cancelRequestBtn')?.addEventListener('click', () => signOut(auth));
$('#activationForm')?.addEventListener('submit', activateWithTemporaryKey);
$('#backFromActivationBtn')?.addEventListener('click', () => state.request ? showPendingRequest(state.request) : showRequestForm());
$('#pinForm')?.addEventListener('submit', handlePinSubmit);
$('#pinSignOutBtn')?.addEventListener('click', changeAccount);
$('#lockBtn').addEventListener('click', () => {
  state.unlocked = false;
  stopDataSync();
  showPinUnlock();
});
$('#signOutBtn').addEventListener('click', changeAccount);
$('#validateNowBtn').addEventListener('click', async () => {
  if (!navigator.onLine) return toast('Conéctate para validar con Firebase.');
  await renewAccessSilently();
  toast('Validación completada.');
  renderDashboard();
});

$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#nav').addEventListener('click', event => {
  const button = event.target.closest('button[data-view]');
  if (button) showView(button.dataset.view);
});

$('#dashboardCampaignFilter').addEventListener('change', renderDashboard);
$('#salesCampaignFilter').addEventListener('change', renderSales);
$('#salesStatusFilter').addEventListener('change', renderSales);
$('#salesSearch').addEventListener('input', renderSales);
$('#resultForm select[name="campaignId"]').addEventListener('change', renderWinnerSummary);

$('#campaignForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const numberMin = Number(form.get('numberMin'));
  const numberMax = Number(form.get('numberMax'));
  const numberWidth = Number(form.get('numberWidth'));
  if (!Number.isInteger(numberMin) || !Number.isInteger(numberMax) || numberMin < 0 || numberMax < numberMin) return toast('Revisa el rango numérico.');
  const campaign = {
    id: makeId('campaign'),
    name: String(form.get('name') || '').trim(),
    numberMin,
    numberMax,
    numberWidth,
    eligibility: String(form.get('eligibility') || 'paid'),
    allowRepeated: form.get('allowRepeated') === 'on',
    notes: String(form.get('notes') || '').trim(),
    status: 'active',
    deleted: false
  };
  await saveEntity('campaigns', campaign, 'Campaña creada.', 'campaign.created');
  event.currentTarget.reset();
  event.currentTarget.numberMin.value = 0;
  event.currentTarget.numberMax.value = 99;
  event.currentTarget.numberWidth.value = 2;
  event.currentTarget.allowRepeated.checked = true;
});

$('#campaignList').addEventListener('click', async event => {
  const toggle = event.target.closest('[data-campaign-toggle]');
  const remove = event.target.closest('[data-campaign-delete]');
  if (toggle) {
    const campaign = getCampaign(toggle.dataset.campaignToggle);
    if (!campaign) return;
    const updated = { ...campaign, status: campaign.status === 'active' ? 'closed' : 'active' };
    await saveEntity('campaigns', updated, 'Estado de campaña actualizado.', 'campaign.statusChanged');
  }
  if (remove) {
    const campaign = getCampaign(remove.dataset.campaignDelete);
    if (!campaign) return;
    const hasSales = state.data.sales.some(sale => !sale.deleted && sale.campaignId === campaign.id);
    if (hasSales) return toast('No se puede eliminar una campaña con ventas.');
    if (confirm(`¿Eliminar la campaña “${campaign.name}”?`)) {
      await saveEntity('campaigns', { ...campaign, deleted: true }, 'Campaña eliminada.', 'campaign.deleted');
    }
  }
});

$('#saleForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const campaign = getCampaign(String(form.get('campaignId') || ''));
  if (!campaign || campaign.status !== 'active') return toast('Selecciona una campaña activa.');
  let number;
  try { number = numberForCampaign(form.get('number'), campaign); }
  catch (error) { return toast(error.message); }
  if (!campaign.allowRepeated) {
    const alreadyUsed = state.data.sales.some(sale => !sale.deleted && sale.campaignId === campaign.id && sale.number === number && sale.paymentStatus !== 'cancelled');
    if (alreadyUsed) return toast(`El número ${number} ya fue registrado en esta campaña.`);
  }
  const quantity = Number(form.get('quantity'));
  const amount = Number(form.get('amount'));
  if (!Number.isInteger(quantity) || quantity < 1) return toast('La cantidad debe ser un entero mayor que cero.');
  if (!Number.isFinite(amount) || amount < 0) return toast('El monto no es válido.');
  const sale = {
    id: makeId('sale'),
    campaignId: campaign.id,
    number,
    quantity,
    customerName: String(form.get('customerName') || '').trim(),
    phone: String(form.get('phone') || '').trim(),
    amount,
    paymentStatus: String(form.get('paymentStatus') || 'pending'),
    notes: String(form.get('notes') || '').trim(),
    sellerId: state.user.uid,
    sellerName: state.actor.name,
    deleted: false
  };
  await saveEntity('sales', sale, `Número ${number} registrado.`, 'sale.created');
  event.currentTarget.reset();
  event.currentTarget.quantity.value = 1;
  event.currentTarget.amount.value = 0;
});

$('#salesTable').addEventListener('click', event => {
  const button = event.target.closest('[data-edit-sale]');
  if (!button) return;
  const sale = visibleSales().find(item => item.id === button.dataset.editSale);
  if (!sale) return;
  const form = $('#editSaleForm');
  form.elements.namedItem('id').value = sale.id;
  form.elements.namedItem('customerName').value = sale.customerName;
  form.elements.namedItem('phone').value = sale.phone || '';
  form.elements.namedItem('number').value = sale.number;
  form.elements.namedItem('quantity').value = sale.quantity;
  form.elements.namedItem('amount').value = sale.amount;
  form.elements.namedItem('paymentStatus').value = sale.paymentStatus;
  form.elements.namedItem('notes').value = sale.notes || '';
  $('#editSaleDialog').showModal();
});

$('#editSaleForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const sale = visibleSales().find(item => item.id === form.get('id'));
  if (!sale) return toast('No se encontró la venta.');
  const campaign = getCampaign(sale.campaignId);
  let number;
  try { number = numberForCampaign(form.get('number'), campaign); }
  catch (error) { return toast(error.message); }
  const updated = {
    ...sale,
    customerName: String(form.get('customerName') || '').trim(),
    phone: String(form.get('phone') || '').trim(),
    number,
    quantity: Math.max(1, Number(form.get('quantity')) || 1),
    amount: Math.max(0, Number(form.get('amount')) || 0),
    paymentStatus: String(form.get('paymentStatus') || 'pending'),
    notes: String(form.get('notes') || '').trim()
  };
  await saveEntity('sales', updated, 'Venta actualizada.', 'sale.updated');
  $('#editSaleDialog').close();
});

$('#closeEditDialogBtn').addEventListener('click', () => $('#editSaleDialog').close());
$('#cancelEditDialogBtn').addEventListener('click', () => $('#editSaleDialog').close());

$('#resultForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const campaign = getCampaign(String(form.get('campaignId') || ''));
  if (!campaign) return toast('Selecciona una campaña.');
  let winningNumber;
  try { winningNumber = numberForCampaign(form.get('winningNumber'), campaign); }
  catch (error) { return toast(error.message); }
  let result = state.data.results.find(item => !item.deleted && item.campaignId === campaign.id);
  if (result) {
    const relatedDeliveries = state.data.deliveries.filter(delivery => !delivery.deleted && delivery.resultId === result.id);
    await Promise.all(relatedDeliveries.map(delivery => saveEntity('deliveries', { ...delivery, deleted: true }, '', 'delivery.cleared')));
    result = { ...result, winningNumber, notes: String(form.get('notes') || '').trim() };
  } else {
    result = { id: makeId('result'), campaignId: campaign.id, winningNumber, notes: String(form.get('notes') || '').trim(), deleted: false };
  }
  await saveEntity('results', result, `Consulta del número ${winningNumber} guardada.`, 'result.saved');
});

$('#winnerSummary').addEventListener('click', async event => {
  const button = event.target.closest('[data-delivery-key]');
  if (!button) return;
  const resultId = button.dataset.resultId;
  const groupKey = button.dataset.deliveryKey;
  let delivery = deliveryFor(resultId, groupKey);
  if (!delivery) {
    delivery = { id: makeId('delivery'), resultId, groupKey, delivered: true, deliveredAt: now(), deliveredBy: state.actor.name, deleted: false };
  } else {
    delivery = {
      ...delivery,
      delivered: !delivery.delivered,
      deliveredAt: delivery.delivered ? null : now(),
      deliveredBy: delivery.delivered ? null : state.actor.name
    };
  }
  await saveEntity('deliveries', delivery, delivery.delivered ? 'Entrega marcada como realizada.' : 'Entrega marcada como pendiente.', 'delivery.updated');
});

$('#refreshDevicesBtn').addEventListener('click', refreshDevices);
$('#requestList').addEventListener('click', async event => {
  const generate = event.target.closest('[data-generate-key]');
  const reject = event.target.closest('[data-reject]');
  if (generate) {
    const requestSnap = await getDoc(doc(db, 'deviceRequests', generate.dataset.generateKey));
    if (!requestSnap.exists()) return toast('Solicitud no encontrada.');
    const request = requestSnap.data();
    const form = $('#keyForm');
    form.elements.namedItem('targetUid').value = generate.dataset.generateKey;
    form.elements.namedItem('mode').value = 'activation';
    form.elements.namedItem('userName').value = request.userName || 'Usuario';
    form.elements.namedItem('deviceName').value = request.deviceName || 'Dispositivo';
    form.elements.namedItem('offlineHours').value = '24';
    form.elements.namedItem('expiresMinutes').value = '30';
    $('#keyDialogTitle').textContent = 'Activar dispositivo';
    $('#keyDialog').showModal();
  }
  if (reject && confirm('¿Rechazar esta solicitud?')) {
    try {
      await rejectRequest(reject.dataset.reject);
      toast('Solicitud rechazada.');
      refreshDevices();
    } catch (error) { toast(error.message); }
  }
});

$('#deviceList').addEventListener('click', async event => {
  const recovery = event.target.closest('[data-recovery-key]');
  if (recovery) {
    const deviceSnap = await getDoc(doc(db, 'devices', recovery.dataset.recoveryKey));
    if (!deviceSnap.exists()) return toast('Dispositivo no encontrado.');
    const device = deviceSnap.data();
    const form = $('#keyForm');
    form.elements.namedItem('targetUid').value = recovery.dataset.recoveryKey;
    form.elements.namedItem('mode').value = 'recovery';
    form.elements.namedItem('userName').value = device.userName || 'Usuario';
    form.elements.namedItem('deviceName').value = device.deviceName || 'Dispositivo';
    form.elements.namedItem('offlineHours').value = String(device.offlineHours || 24);
    form.elements.namedItem('expiresMinutes').value = '30';
    $('#keyDialogTitle').textContent = 'Recuperar acceso';
    $('#keyDialog').showModal();
    return;
  }
  const button = event.target.closest('[data-toggle-device]');
  if (!button) return;
  const active = button.dataset.active === '1';
  if (!confirm(active ? '¿Revocar este dispositivo?' : '¿Reactivar este dispositivo?')) return;
  try {
    await toggleDevice(button.dataset.toggleDevice, active);
    toast(active ? 'Dispositivo revocado.' : 'Dispositivo reactivado.');
    refreshDevices();
  } catch (error) { toast(error.message); }
});

$('#keyForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    const result = await createTemporaryKey(
      String(data.get('targetUid')),
      String(data.get('userName')),
      String(data.get('deviceName')),
      Number(data.get('offlineHours')),
      Number(data.get('expiresMinutes')),
      String(data.get('mode') || 'activation')
    );
    $('#keyDialog').close();
    showGeneratedKey(result);
    refreshDevices();
  } catch (error) { toast(error.message); }
});
$('#closeKeyDialogBtn').addEventListener('click', () => $('#keyDialog').close());
$('#cancelKeyBtn').addEventListener('click', () => $('#keyDialog').close());
$('#closeKeyResultBtn').addEventListener('click', () => $('#keyResultDialog').close());
$('#copyGeneratedKeyBtn').addEventListener('click', async () => {
  if (!state.generatedKey) return;
  await navigator.clipboard.writeText(state.generatedKey.plainKey);
  toast('Clave copiada.');
});

$('#exportJsonBtn').addEventListener('click', exportJson);
$('#exportCsvBtn').addEventListener('click', exportCsv);
$('#salesPrintBtn').addEventListener('click', () => printView('sales'));
$('#winnerPrintBtn').addEventListener('click', () => printView('result'));
$('#printAllBtn').addEventListener('click', () => printView('dashboard'));
$('#migrateLegacyBtn').addEventListener('click', migrateLegacyData);

$('#importJsonInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.campaigns) || !Array.isArray(parsed.sales)) throw new Error('Formato no reconocido');
    if (!confirm('La importación agregará o actualizará registros en Firebase. ¿Continuar?')) return;
    await saveManyFromData(parsed);
  } catch (error) {
    toast(`No se pudo importar: ${error.message}`);
  } finally {
    event.target.value = '';
  }
});

$('#resetDeviceBtn').addEventListener('click', async () => {
  if (!confirm('¿Eliminar el PIN y la validación local de este dispositivo? Los datos de Firebase no se borrarán.')) return;
  clearLocalAccess();
  stopDataSync();
  if (navigator.onLine) await evaluateAccess({ forceServer: true });
  else showBlocked('Acceso local restablecido.', 'Conecta el dispositivo para renovar su autorización.');
});

['#installBtn', '#installAccessBtn', '#installBackupBtn'].forEach(selector => $(selector)?.addEventListener('click', requestInstall));

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  refreshInstallButtons();
});
window.addEventListener('appinstalled', () => {
  state.deferredInstallPrompt = null;
  refreshInstallButtons();
  toast('Aplicación instalada.');
});
window.addEventListener('online', async () => {
  updateConnectionUi();
  if (state.user && state.unlocked) await renewAccessSilently();
  else if (state.user) await evaluateAccess({ forceServer: true });
  if (state.unlocked) renderAll();
});
window.addEventListener('offline', () => {
  updateConnectionUi();
  if (state.unlocked && leaseRemaining() <= 0) {
    state.unlocked = false;
    stopDataSync();
    showBlocked('El permiso offline venció.', 'Conecta el dispositivo para renovar el acceso.');
  } else if (state.unlocked) renderAll();
});

onAuthStateChanged(auth, async user => {
  stopDataSync();
  state.accessUnsub?.();
  state.accessUnsub = null;
  state.user = user;
  state.admin = Boolean(user && user.uid === ADMIN_UID && !user.isAnonymous);
  state.actor = null;
  state.device = null;
  state.request = null;
  state.unlocked = false;
  state.lease = user ? readJson(leaseKey()) : null;
  if (!user) {
    showOnly('accessView');
    updateConnectionUi();
    if (ENTRY_MODE === 'device' && new URLSearchParams(location.search).get('solicitar') === '1' && !autoRequestStarted && navigator.onLine) {
      autoRequestStarted = true;
      setTimeout(() => $('#startRequestBtn')?.click(), 80);
    }
    return;
  }
  if (ENTRY_MODE === 'admin' && !state.admin) {
    await signOut(auth);
    const error = $('#loginError');
    if (error) error.textContent = 'Esta cuenta no tiene permiso administrativo.';
    return;
  }
  if (!state.admin && !user.isAnonymous) {
    showBlocked('Este dispositivo no está autorizado.', 'Solicita acceso desde la portada de Númina.');
    return;
  }
  await evaluateAccess();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.error('Service Worker:', error)));
}

updateConnectionUi();
refreshInstallButtons();
