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
const APP_VERSION = 'firebase-completa-v1.5.0-series';
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

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function derivePinHash(pin, saltBytes, iterations = PIN_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(pin)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: saltBytes,
    iterations
  }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function createPinRecord(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return JSON.stringify({
    version: 2,
    algorithm: 'PBKDF2-SHA-256',
    iterations: PIN_ITERATIONS,
    salt: bytesToBase64(salt),
    hash: await derivePinHash(pin, salt, PIN_ITERATIONS)
  });
}

async function verifyStoredPin(pin) {
  const stored = localStorage.getItem(pinKey());
  if (!stored) return { valid: false, legacy: false };
  try {
    const record = JSON.parse(stored);
    if (record?.version === 2 && record.algorithm === 'PBKDF2-SHA-256' && record.salt && record.hash) {
      const hash = await derivePinHash(pin, base64ToBytes(record.salt), Number(record.iterations || PIN_ITERATIONS));
      return { valid: hash === record.hash, legacy: false };
    }
  } catch { /* PIN heredado SHA-256 */ }
  return { valid: await sha256(pin) === stored, legacy: true };
}

function errorLogKey() {
  return userKey(ERROR_LOG_PREFIX);
}

function sanitizeErrorMessage(value) {
  return String(value || 'Error desconocido')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[correo]')
    .replace(/\b\d{7,}\b/g, '[número]')
    .replace(/\s+/g, ' ')
    .slice(0, 280);
}

function readErrorLog() {
  return readJson(errorLogKey()) || [];
}

function recordError(context, error) {
  try {
    const entries = readErrorLog();
    entries.unshift({
      at: now(),
      context: String(context || 'general').slice(0, 80),
      code: String(error?.code || '').slice(0, 80),
      message: sanitizeErrorMessage(error?.message || error),
      online: navigator.onLine,
      version: APP_VERSION
    });
    writeJson(errorLogKey(), entries.slice(0, 50));
  } catch { /* no bloquear la aplicación por el diagnóstico */ }
}

function lastSyncKey() {
  return userKey(LAST_SYNC_PREFIX);
}

function storeLastSync() {
  state.lastSyncAt = Date.now();
  localStorage.setItem(lastSyncKey(), String(state.lastSyncAt));
}

function cleanPhone(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validatePhone(value) {
  const phone = cleanPhone(value);
  const digits = normalizePhone(phone);
  if (phone && digits.length < 7) throw new Error('El teléfono parece demasiado corto. Escribe al menos 7 dígitos o déjalo vacío.');
  if (digits.length > 20) throw new Error('El teléfono contiene demasiados dígitos.');
  return phone;
}

function applyPrivacyMode() {
  document.body.classList.toggle('privacy-mode', state.privacyMode);
  const button = $('#privacyBtn');
  if (button) {
    button.setAttribute('aria-pressed', state.privacyMode ? 'true' : 'false');
    button.title = state.privacyMode ? 'Mostrar información sensible' : 'Ocultar información sensible';
    button.textContent = state.privacyMode ? '◉' : '◌';
  }
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
  if (ms < 60000) return `${Math.max(1, Math.ceil(ms / 1000))} s`;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 48) return `${Math.floor(hours / 24)} d ${hours % 24} h`;
  if (hours === 0) return `${Math.max(1, minutes)} min`;
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
  $('#pinMessage').textContent = `Crea un PIN de 6 a 8 números. Se guardará cifrado localmente. Permiso offline: ${leaseHours()} horas.`;
  const pinInput = $('#pinForm input[name="pin"]');
  const confirmInput = $('#pinForm input[name="pinConfirm"]');
  if (pinInput) { pinInput.pattern = '[0-9]{6,8}'; pinInput.placeholder = '6 a 8 números'; }
  if (confirmInput) confirmInput.pattern = '[0-9]{6,8}';
  $('#pinConfirmLabel').classList.remove('hidden');
  $('#pinForm input[name="pinConfirm"]').required = true;
  $('#pinForm').reset();
  showOnly('pinView');
}

function showPinUnlock() {
  state.pinMode = 'unlock';
  $('#pinTitle').textContent = 'Desbloquear Númina';
  $('#pinMessage').textContent = `Permiso offline restante: ${humanDuration(leaseRemaining())}.`;
  const pinInput = $('#pinForm input[name="pin"]');
  if (pinInput) { pinInput.pattern = '[0-9]{4,8}'; pinInput.placeholder = 'PIN del dispositivo'; }
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
  const requiredPattern = state.pinMode === 'setup' ? /^\d{6,8}$/ : /^\d{4,8}$/;
  if (!requiredPattern.test(pin)) return toast(state.pinMode === 'setup' ? 'El PIN nuevo debe tener entre 6 y 8 números.' : 'El PIN no tiene un formato válido.');

  if (state.pinMode === 'setup') {
    if (pin !== confirmPin) return toast('Los PIN no coinciden.');
    localStorage.setItem(pinKey(), await createPinRecord(pin));
    savePinFailures({ count: 0, blockedUntil: 0, level: 0 });
    state.unlocked = true;
    enterApp();
    return;
  }

  const failures = readPinFailures();
  if (failures.blockedUntil > Date.now()) return toast(`Espera ${humanDuration(failures.blockedUntil - Date.now())} antes de intentar otra vez.`);
  const verification = await verifyStoredPin(pin);
  if (!verification.valid) {
    const count = Number(failures.count || 0) + 1;
    const currentLevel = Number(failures.level || 0);
    let blockedUntil = 0;
    let nextLevel = currentLevel;
    let message = 'PIN incorrecto.';
    if (count >= 3) {
      nextLevel = Math.min(3, currentLevel + 1);
      const delays = [0, 30000, 120000, 600000];
      const delay = delays[nextLevel];
      blockedUntil = Date.now() + delay;
      message = `Demasiados intentos. Bloqueado durante ${humanDuration(delay)}.`;
    }
    savePinFailures({ count: blockedUntil ? 0 : count, blockedUntil, level: nextLevel });
    return toast(message);
  }
  if (verification.legacy) {
    localStorage.setItem(pinKey(), await createPinRecord(pin));
  }
  savePinFailures({ count: 0, blockedUntil: 0, level: 0 });
  state.unlocked = true;
  enterApp();
  if (verification.legacy && pin.length < 6) toast('PIN antiguo reforzado. Para usar 6 o más dígitos, restablece el acceso local cuando te convenga.');
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
        if (navigator.onLine && state.collectionLoaded.size === ENTITY_COLLECTIONS.length && pendingWriteCount() === 0) storeLastSync();
        updateSyncUi();
        renderAll();
      },
      error => {
        console.error(`Sincronización ${collectionName}`, error);
        recordError(`sync.${collectionName}`, error);
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
    recordError(`save.${collectionName}`, error);
    toast(error.code === 'permission-denied' ? 'Firebase rechazó la operación.' : `No se pudo guardar: ${error.message}`);
  }
}

function normalizeImportedEntity(collectionName, item) {
  const normalized = { ...item };
  delete normalized._pending;
  delete normalized.serverCreatedAt;
  delete normalized.serverUpdatedAt;
  if (collectionName === 'campaigns') {
    normalized.factorEnabled = item?.factorEnabled === true;
    const value = Number(item?.factor);
    normalized.factor = normalized.factorEnabled && Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (collectionName === 'deliveries') {
    const value = Number(item?.manualResult);
    const validManualResult = item?.manualResult !== null && item?.manualResult !== undefined && item?.manualResult !== '' && Number.isFinite(value) && value >= 0;
    normalized.manualResult = validManualResult ? value : null;
    normalized.manualResultUpdatedAt = item?.manualResultUpdatedAt || null;
    normalized.manualResultUpdatedBy = item?.manualResultUpdatedBy || null;
  }
  return normalized;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasForbiddenImportKey(value, depth = 0) {
  if (depth > 12) return true;
  if (value === null || typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return true;
    if (hasForbiddenImportKey(value[key], depth + 1)) return true;
  }
  return false;
}

function importRecordErrors(collectionName, item) {
  const errors = [];
  if (!isPlainObject(item)) return ['El registro no es un objeto.'];
  if (hasForbiddenImportKey(item)) errors.push('Contiene claves no permitidas.');
  if (typeof item.id !== 'string' || !IMPORT_ID_PATTERN.test(item.id)) errors.push('El identificador falta o no es seguro.');
  if (collectionName === 'campaigns') {
    if (typeof item.name !== 'string' || !item.name.trim()) errors.push('La campaña no tiene nombre.');
    if (!Number.isFinite(Number(item.numberMin)) || !Number.isFinite(Number(item.numberMax))) errors.push('El rango numérico no es válido.');
    if (item.factorEnabled === true && (!Number.isFinite(Number(item.factor)) || Number(item.factor) < 0)) errors.push('El factor no es válido.');
  }
  if (collectionName === 'sales') {
    if (typeof item.campaignId !== 'string' || !item.campaignId) errors.push('Falta campaignId.');
    if (item.number === null || item.number === undefined || String(item.number).length > 40) errors.push('El número no es válido.');
    if (typeof item.customerName !== 'string' || !item.customerName.trim()) errors.push('Falta el cliente.');
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 1) errors.push('Las participaciones no son válidas.');
    if (!Number.isFinite(Number(item.amount)) || Number(item.amount) < 0) errors.push('El monto no es válido.');
    if (item.paymentStatus && !['pending', 'paid', 'cancelled'].includes(item.paymentStatus)) errors.push('El estado no es válido.');
  }
  if (collectionName === 'results') {
    if (typeof item.campaignId !== 'string' || !item.campaignId) errors.push('Falta campaignId.');
    if (item.winningNumber === null || item.winningNumber === undefined) errors.push('Falta el número consultado.');
  }
  if (collectionName === 'deliveries') {
    if (typeof item.resultId !== 'string' || !item.resultId) errors.push('Falta resultId.');
    if (typeof item.groupKey !== 'string' || !item.groupKey) errors.push('Falta groupKey.');
    if (item.delivered !== undefined && typeof item.delivered !== 'boolean') errors.push('El estado de entrega no es booleano.');
    if (item.manualResult !== null && item.manualResult !== undefined && item.manualResult !== '' && (!Number.isFinite(Number(item.manualResult)) || Number(item.manualResult) < 0)) errors.push('El resultado manual no es válido.');
  }
  return errors;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}

function importedFieldsMatch(collectionName, imported, existing) {
  if (!existing) return false;
  const ignored = new Set(['updatedAt', 'updatedByUid', 'updatedByName', 'updatedByDevice', 'serverUpdatedAt', '_pending']);
  const normalizedExisting = normalizeImportedEntity(collectionName, cleanExportItem(existing));
  return Object.keys(imported).filter(key => !ignored.has(key)).every(key => (
    JSON.stringify(stableValue(imported[key])) === JSON.stringify(stableValue(normalizedExisting[key]))
  ));
}

function prepareImportData(data) {
  if (!isPlainObject(data)) throw new Error('El respaldo debe contener un objeto JSON.');
  const summary = { total: 0, newCount: 0, updateCount: 0, unchangedCount: 0, invalidCount: 0, duplicateCount: 0 };
  const operations = [];
  const issues = [];
  const seen = new Set();

  for (const collectionName of ENTITY_COLLECTIONS) {
    const items = data[collectionName] === undefined ? [] : data[collectionName];
    if (!Array.isArray(items)) throw new Error(`La sección ${collectionName} debe ser una lista.`);
    for (let index = 0; index < items.length; index += 1) {
      summary.total += 1;
      const item = items[index];
      const errors = importRecordErrors(collectionName, item);
      if (errors.length) {
        summary.invalidCount += 1;
        if (issues.length < 30) issues.push(`${collectionName}[${index + 1}]: ${errors.join(' ')}`);
        continue;
      }
      const key = `${collectionName}:${item.id}`;
      if (seen.has(key)) {
        summary.duplicateCount += 1;
        if (issues.length < 30) issues.push(`${collectionName}/${item.id}: duplicado dentro del archivo.`);
        continue;
      }
      seen.add(key);
      const normalized = normalizeImportedEntity(collectionName, item);
      const existing = state.data[collectionName].find(record => record.id === normalized.id) || null;
      if (!existing) {
        summary.newCount += 1;
        operations.push({ name: collectionName, item: normalized, existing: null, mode: 'new' });
      } else if (importedFieldsMatch(collectionName, normalized, existing)) {
        summary.unchangedCount += 1;
      } else {
        summary.updateCount += 1;
        operations.push({ name: collectionName, item: normalized, existing, mode: 'update' });
      }
    }
  }

  const campaignIds = new Set([
    ...state.data.campaigns.map(item => item.id),
    ...operations.filter(item => item.name === 'campaigns').map(item => item.item.id)
  ]);
  const resultIds = new Set([
    ...state.data.results.map(item => item.id),
    ...operations.filter(item => item.name === 'results').map(item => item.item.id)
  ]);
  for (const operation of operations) {
    if (operation.name === 'sales' && !campaignIds.has(operation.item.campaignId) && issues.length < 30) issues.push(`sales/${operation.item.id}: campaignId no está presente en el respaldo ni en la aplicación.`);
    if (operation.name === 'results' && !campaignIds.has(operation.item.campaignId) && issues.length < 30) issues.push(`results/${operation.item.id}: campaignId no está presente.`);
    if (operation.name === 'deliveries' && !resultIds.has(operation.item.resultId) && issues.length < 30) issues.push(`deliveries/${operation.item.id}: resultId no está presente.`);
  }
  return { summary, operations, issues, sourceVersion: data.version ?? 'sin indicar' };
}

async function savePreparedImport(plan, message = 'Importación completada.') {
  if (!plan?.operations?.length) return toast('No hay registros nuevos o modificados para importar.');
  let completed = 0;
  for (let index = 0; index < plan.operations.length; index += 350) {
    const batch = writeBatch(db);
    for (const operation of plan.operations.slice(index, index + 350)) {
      const normalized = { ...operation.item };
      const originalCreator = !operation.existing && normalized.createdByUid && normalized.createdByUid !== state.user.uid
        ? { importedCreatedByUid: normalized.createdByUid, importedCreatedByName: normalized.createdByName || '' }
        : {};
      const payload = {
        ...normalized,
        ...originalCreator,
        ...actorFields(operation.existing)
      };
      if (!operation.existing && normalized.createdAt) payload.createdAt = normalized.createdAt;
      batch.set(doc(db, operation.name, normalized.id), payload, { merge: true });
      completed += 1;
    }
    await batch.commit();
  }
  writeAudit('data.imported', {
    processed: completed,
    newCount: plan.summary.newCount,
    updateCount: plan.summary.updateCount,
    unchangedCount: plan.summary.unchangedCount,
    invalidCount: plan.summary.invalidCount,
    duplicateCount: plan.summary.duplicateCount
  });
  toast(`${message} ${completed} registros procesados.`);
}

async function saveManyFromData(data, message = 'Datos importados.') {
  const plan = prepareImportData(data);
  if (!plan.operations.length) return toast('No hay registros nuevos o modificados para importar.');
  await savePreparedImport(plan, message);
}

function renderImportPreview(plan) {
  const summary = plan.summary;
  $('#importPreviewSummary').innerHTML = `
    <div class="import-stat"><span>Total revisado</span><strong>${summary.total}</strong></div>
    <div class="import-stat"><span>Nuevos</span><strong>${summary.newCount}</strong></div>
    <div class="import-stat"><span>Se actualizarán</span><strong>${summary.updateCount}</strong></div>
    <div class="import-stat"><span>Sin cambios</span><strong>${summary.unchangedCount}</strong></div>
    <div class="import-stat"><span>Duplicados omitidos</span><strong>${summary.duplicateCount}</strong></div>
    <div class="import-stat"><span>Inválidos omitidos</span><strong>${summary.invalidCount}</strong></div>`;
  $('#importPreviewMeta').textContent = `Versión del respaldo: ${plan.sourceVersion}. Se escribirán ${plan.operations.length} registros.`;
  $('#importPreviewIssues').innerHTML = plan.issues.length
    ? `<strong>Advertencias</strong><ul>${plan.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
    : '<span>No se encontraron advertencias estructurales.</span>';
  $('#confirmImportBtn').disabled = plan.operations.length === 0;
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

function campaignUsesSeries(campaign) {
  return campaign?.useSeries === true;
}

function campaignFactorEnabled(campaign) {
  return campaign?.factorEnabled === true;
}

function campaignFactor(campaign) {
  if (!campaignFactorEnabled(campaign)) return null;
  const value = Number(campaign?.factor);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatPlainNumber(value) {
  return new Intl.NumberFormat('es-CR', { maximumFractionDigits: 20 }).format(Number(value));
}

function campaignFactorLabel(campaign) {
  const value = campaignFactor(campaign);
  return value === null ? 'Sin factor' : `Factor ${formatPlainNumber(value)}`;
}

function hasManualResult(delivery) {
  if (!delivery || delivery.manualResult === null || delivery.manualResult === undefined || delivery.manualResult === '') return false;
  const value = Number(delivery.manualResult);
  return Number.isFinite(value) && value >= 0;
}

function manualResultValue(delivery) {
  return hasManualResult(delivery) ? Number(delivery.manualResult) : null;
}

function seriesForCampaign(value, campaign) {
  if (!campaignUsesSeries(campaign)) return '';
  const series = String(value || '').trim().toUpperCase();
  if (!series) throw new Error('La serie es obligatoria para esta campaña.');
  if (series.length > 40) throw new Error('La serie no puede superar 40 caracteres.');
  return series;
}

function numberSeriesLabel(number, series, campaign) {
  return campaignUsesSeries(campaign) ? `${number} · Serie ${series || '—'}` : number;
}

function updateFactorField({ clearWhenDisabled = false } = {}) {
  const form = $('#campaignForm');
  const checkbox = form?.elements.namedItem('factorEnabled');
  const input = form?.elements.namedItem('factor');
  if (!checkbox || !input) return;
  const enabled = checkbox.checked;
  input.disabled = !enabled;
  input.required = enabled;
  if (!enabled && clearWhenDisabled) input.value = '';
}

function updateSeriesFields() {
  const saleCampaign = getCampaign($('#saleForm select[name="campaignId"]')?.value);
  const saleField = $('[data-series-field="sale"]');
  const saleInput = saleField?.querySelector('input[name="series"]');
  const saleEnabled = campaignUsesSeries(saleCampaign);
  saleField?.classList.toggle('hidden', !saleEnabled);
  if (saleInput) {
    saleInput.required = saleEnabled;
    if (!saleEnabled) saleInput.value = '';
  }

  const resultCampaign = getCampaign($('#resultForm select[name="campaignId"]')?.value);
  const resultField = $('[data-series-field="result"]');
  const resultInput = resultField?.querySelector('input[name="winningSeries"]');
  const resultEnabled = campaignUsesSeries(resultCampaign);
  resultField?.classList.toggle('hidden', !resultEnabled);
  if (resultInput) {
    resultInput.required = resultEnabled;
    if (!resultEnabled) resultInput.value = '';
  }
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
  options.push(...campaigns.map(campaign => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)}${campaignUsesSeries(campaign) ? ' · con serie' : ''}</option>`));
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
  updateSeriesFields();
  updateFactorField();

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
    ['Ventas', valid.length, 'registros activos', ''],
    ['Participaciones', participationCount, 'cantidad total', ''],
    ['Cobrado', formatAmount(totalAmount), 'ventas pagadas', 'sensitive-value sensitive-amount'],
    ['Pendientes', pending.length, 'ventas sin pagar', '']
  ].map(([label, value, note, className]) => `<article class="metric-card"><span>${label}</span><strong class="${className}">${value}</strong><small>${note}</small></article>`).join('');

  const recent = [...sales].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 8);
  $('#recentSales').innerHTML = recent.length ? recent.map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return `<div class="list-item"><div><strong>${escapeHtml(sale.customerName)}</strong><small>${escapeHtml(campaign?.name || 'Campaña')} · ${escapeHtml(numberSeriesLabel(sale.number, sale.series, campaign))} · <span class="sensitive-value sensitive-operator">${escapeHtml(sale.sellerName || sale.createdByName || 'Usuario')}</span></small></div><div><span class="status-pill ${sale.paymentStatus}">${paymentLabel(sale.paymentStatus)}</span><small>${sale._pending ? '<span class="pending-dot"></span>Pendiente' : '<span class="server-dot"></span>Confirmado'}</small></div></div>`;
  }).join('') : '<div class="empty">Todavía no hay ventas registradas.</div>';

  $('#localSummary').innerHTML = `
    <div class="sync-line"><span>Cuenta</span><strong>${escapeHtml(state.actor.name)}</strong></div>
    <div class="sync-line"><span>Dispositivo</span><strong>${escapeHtml(currentDeviceName())}</strong></div>
    <div class="sync-line"><span>Sincronización</span><strong>${pendingWriteCount() ? `${pendingWriteCount()} pendiente(s)` : 'Confirmada'}</strong></div>
    <div class="sync-line"><span>Última sincronización</span><strong>${state.lastSyncAt ? formatDate(state.lastSyncAt) : 'Todavía no registrada'}</strong></div>
    <div class="sync-line"><span>Conexión actual</span><strong>${navigator.onLine ? 'En línea' : 'Sin conexión'}</strong></div>
    <div class="sync-line"><span>Autorización</span><strong>${state.device?.active === false ? 'Revocada' : 'Activa'}</strong></div>
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
        <span class="meta-chip">${campaign.allowRepeated ? 'Registros repetidos' : 'Registros exclusivos'}</span>
        <span class="meta-chip">${campaignUsesSeries(campaign) ? 'Número + serie' : 'Solo número'}</span>
        <span class="meta-chip">${campaign.eligibility === 'paid' ? 'Solo pagados' : 'Pagados y pendientes'}</span>
        <span class="meta-chip factor-chip">${escapeHtml(campaignFactorLabel(campaign))}</span>
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
      const haystack = normalizeText([sale.number, sale.series, sale.customerName, sale.phone, sale.sellerName, sale.createdByName].join(' '));
      if (!haystack.includes(searchText)) return false;
    }
    return true;
  }).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

function renderSales() {
  const sales = filteredSales();
  const header = '<div class="table-row header"><span>Número</span><span>Cliente</span><span>Teléfono</span><span>Cantidad</span><span>Monto</span><span>Estado</span><span>Acción</span></div>';
  const rows = sales.map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return `<div class="table-row">
    <span><span class="number-chip">${escapeHtml(numberSeriesLabel(sale.number, sale.series, campaign))}</span></span>
    <span><strong>${escapeHtml(sale.customerName)}</strong><small>${escapeHtml(campaign?.name || 'Campaña')} · ${escapeHtml(campaignFactorLabel(campaign))}</small><small><span class="sensitive-value sensitive-operator">${escapeHtml(sale.sellerName || sale.createdByName || 'Usuario')}</span> · ${formatDate(sale.createdAt)} ${sale._pending ? '· Pendiente' : ''}</small></span>
    <span class="sensitive-value sensitive-phone">${escapeHtml(sale.phone || '—')}</span>
    <span>${Number(sale.quantity || 0)}</span>
    <span class="sensitive-value sensitive-amount">${formatAmount(sale.amount)}</span>
    <span><span class="status-pill ${sale.paymentStatus}">${paymentLabel(sale.paymentStatus)}</span></span>
    <span class="table-actions"><button data-edit-sale="${sale.id}" title="Editar">✎</button></span>
  </div>`;
  }).join('');
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
  const matched = state.data.sales.filter(sale => {
    if (sale.deleted || sale.campaignId !== campaign.id || sale.number !== result.winningNumber || !eligibleStatuses.includes(sale.paymentStatus)) return false;
    return !campaignUsesSeries(campaign) || String(sale.series || '') === String(result.winningSeries || '');
  });
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
    const savedManualResult = manualResultValue(delivery);
    const factorValue = campaignFactor(campaign);
    const seriesDetail = campaignUsesSeries(campaign) ? `<div><span>Serie</span><strong>${escapeHtml(result.winningSeries || '—')}</strong></div>` : '';
    const factorDetail = campaignFactorEnabled(campaign) ? `<div><span>Factor</span><strong>${factorValue === null ? '—' : escapeHtml(formatPlainNumber(factorValue))}</strong></div>` : '';
    const manualMetadata = hasManualResult(delivery) && (delivery.manualResultUpdatedBy || delivery.manualResultUpdatedAt)
      ? `<small>Actualizado${delivery.manualResultUpdatedBy ? ` por <span class="sensitive-value sensitive-operator">${escapeHtml(delivery.manualResultUpdatedBy)}</span>` : ''}${delivery.manualResultUpdatedAt ? ` · ${formatDate(delivery.manualResultUpdatedAt)}` : ''}</small>`
      : '';
    return `<article class="winner-card">
      <header><div><h3>${escapeHtml(group.customerName)}</h3><span class="status-pill ${delivery?.delivered ? 'delivered' : 'pending'}">${delivery?.delivered ? 'Entregado' : 'Pendiente'}</span></div></header>
      <div class="winner-details">
        <div><span>Teléfono</span><strong class="sensitive-value sensitive-phone">${escapeHtml(group.phone || '—')}</strong></div>
        <div><span>Número</span><strong>${escapeHtml(result.winningNumber)}</strong></div>
        ${seriesDetail}
        <div><span>Participaciones</span><strong>${group.quantity}</strong></div>
        <div><span>Monto registrado</span><strong class="sensitive-value sensitive-amount">${formatAmount(group.amount)}</strong></div>
        ${factorDetail}
        <div><span>Registrado por</span><strong class="sensitive-value sensitive-operator">${escapeHtml(group.sellers.join(', '))}</strong></div>
      </div>
      <div class="manual-result-block">
        <label class="manual-result-editor">Resultado manual
          <input class="sensitive-value sensitive-manual" data-manual-result-input inputmode="decimal" min="0" step="any" type="number" value="${savedManualResult === null ? '' : escapeHtml(String(savedManualResult))}" placeholder="0"/>
          ${manualMetadata}
        </label>
        <div class="manual-result-print"><span>Resultado manual</span><strong class="sensitive-value sensitive-manual">${savedManualResult === null ? '—' : escapeHtml(formatPlainNumber(savedManualResult))}</strong></div>
      </div>
      <div class="card-actions">
        <button class="secondary" data-save-manual-result="${escapeHtml(group.key)}" data-result-id="${result.id}" type="button">Guardar resultado</button>
        <button class="${delivery?.delivered ? 'ghost' : 'primary'}" data-delivery-key="${escapeHtml(group.key)}" data-result-id="${result.id}" type="button">${delivery?.delivered ? 'Marcar pendiente' : 'Marcar entregado'}</button>
      </div>
    </article>`;
  }).join('');
  const factorOverview = campaignFactorEnabled(campaign)
    ? `<article class="winner-stat"><span>Factor</span><strong>${campaignFactor(campaign) === null ? '—' : escapeHtml(formatPlainNumber(campaignFactor(campaign)))}</strong></article>`
    : '';
  container.innerHTML = `
    <div class="winner-overview">
      <article class="winner-stat"><span>${campaignUsesSeries(campaign) ? 'Número y serie consultados' : 'Número consultado'}</span><strong>${escapeHtml(numberSeriesLabel(result.winningNumber, result.winningSeries, campaign))}</strong></article>
      <article class="winner-stat"><span>Personas coincidentes</span><strong>${groups.length}</strong></article>
      <article class="winner-stat"><span>Entregas pendientes</span><strong>${pendingDeliveries}</strong></article>
      ${factorOverview}
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

function exportCampaign(campaign) {
  return cleanExportItem({
    ...campaign,
    factorEnabled: campaignFactorEnabled(campaign),
    factor: campaignFactor(campaign)
  });
}

function exportDelivery(delivery) {
  return cleanExportItem({
    ...delivery,
    manualResult: manualResultValue(delivery),
    manualResultUpdatedAt: delivery.manualResultUpdatedAt || null,
    manualResultUpdatedBy: delivery.manualResultUpdatedBy || null
  });
}

function exportJson() {
  const data = {
    version: 3,
    exportedAt: now(),
    campaigns: state.data.campaigns.map(exportCampaign),
    sales: state.data.sales.map(cleanExportItem),
    results: state.data.results.map(cleanExportItem),
    deliveries: state.data.deliveries.map(exportDelivery)
  };
  const stamp = new Date().toISOString().slice(0, 10);
  download(`numina-respaldo-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const headers = ['Fecha', 'Campaña', 'Factor activo', 'Factor', 'Número', 'Serie', 'Cliente', 'Teléfono', 'Participaciones', 'Monto', 'Estado', 'Registrado por', 'Sincronización', 'Notas'];
  const rows = visibleSales().map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return [
      sale.createdAt,
      campaign?.name || '',
      campaignFactorEnabled(campaign) ? 'Sí' : 'No',
      campaignFactor(campaign) ?? '',
      sale.number,
      sale.series || '',
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

function exportCoincidencesCsv() {
  const campaign = getCampaign($('#resultForm select[name="campaignId"]').value);
  const result = currentResult();
  if (!campaign || !result) return toast('Primero realiza una búsqueda de coincidencias.');
  const headers = ['Campaña', 'Cliente', 'Teléfono', 'Número', 'Serie', 'Participaciones', 'Monto registrado', 'Factor activo', 'Factor', 'Resultado manual', 'Estado de entrega', 'Registrado por', 'Fecha'];
  const rows = winnerGroups(result).map(group => {
    const delivery = deliveryFor(result.id, group.key);
    const dates = Array.from(new Set(group.sales.map(sale => sale.createdAt || '').filter(Boolean))).join(' | ');
    return [
      campaign.name,
      group.customerName,
      group.phone || '',
      result.winningNumber,
      campaignUsesSeries(campaign) ? result.winningSeries || '' : '',
      group.quantity,
      group.amount,
      campaignFactorEnabled(campaign) ? 'Sí' : 'No',
      campaignFactor(campaign) ?? '',
      manualResultValue(delivery) ?? '',
      delivery?.delivered ? 'Entregado' : 'Pendiente',
      group.sellers.join(', '),
      dates
    ].map(csvCell).join(',');
  });
  const stamp = new Date().toISOString().slice(0, 10);
  download(`numina-coincidencias-${stamp}.csv`, '\ufeff' + [headers.map(csvCell).join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
}

function openPrintOptions(viewName) {
  state.pendingPrintView = viewName;
  $('#printOptionsForm').reset();
  $('#printOptionsDialog').showModal();
}

function clearPrintState() {
  $$('.view').forEach(element => element.classList.remove('print-target'));
  document.body.classList.remove('print-hide-phone', 'print-hide-amount', 'print-hide-operator', 'print-hide-manual');
}

function performPrint() {
  const view = $(`#view-${state.pendingPrintView}`);
  if (!view) return;
  const data = new FormData($('#printOptionsForm'));
  clearPrintState();
  document.body.classList.toggle('print-hide-phone', data.get('hidePhone') === 'on');
  document.body.classList.toggle('print-hide-amount', data.get('hideAmount') === 'on');
  document.body.classList.toggle('print-hide-operator', data.get('hideOperator') === 'on');
  document.body.classList.toggle('print-hide-manual', data.get('hideManual') === 'on');
  view.classList.add('print-target');
  $('#printOptionsDialog').close();
  window.print();
  setTimeout(clearPrintState, 1000);
}

async function buildDiagnosticReport() {
  const registration = state.serviceWorkerRegistration || await navigator.serviceWorker?.getRegistration?.();
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const cacheNames = typeof caches !== 'undefined' ? await caches.keys() : [];
  const errors = readErrorLog();
  const storageUsed = Number(estimate.usage || 0);
  const storageQuota = Number(estimate.quota || 0);
  const lines = [
    'NÚMINA — DIAGNÓSTICO TÉCNICO',
    `Generado: ${now()}`,
    `Versión: ${APP_VERSION}`,
    `Entrada: ${ENTRY_MODE === 'admin' ? 'administrador' : 'dispositivo'}`,
    `Sesión: ${state.admin ? 'administrador' : state.user?.isAnonymous ? 'operador anónimo autorizado' : state.user ? 'autenticada' : 'sin sesión'}`,
    `Conexión: ${navigator.onLine ? 'en línea' : 'sin conexión'}`,
    `Aplicación desbloqueada: ${state.unlocked ? 'sí' : 'no'}`,
    `Dispositivo activo: ${state.device?.active === false ? 'no' : state.device ? 'sí' : 'sin verificar'}`,
    `Permiso offline restante: ${humanDuration(leaseRemaining())}`,
    `Escrituras pendientes: ${pendingWriteCount()}`,
    `Última sincronización: ${state.lastSyncAt ? formatDate(state.lastSyncAt) : 'sin registro'}`,
    `Service worker: ${registration?.active ? 'activo' : registration?.installing ? 'instalando' : registration?.waiting ? 'esperando' : 'no activo'}`,
    `Cachés: ${cacheNames.length ? cacheNames.join(', ') : 'ninguna detectada'}`,
    `Almacenamiento usado: ${formatBytes(storageUsed)}${storageQuota ? ` de ${formatBytes(storageQuota)}` : ''}`,
    `Errores locales registrados: ${errors.length}`
  ];
  if (errors.length) {
    lines.push('', 'ÚLTIMOS ERRORES (sin datos personales)');
    for (const entry of errors.slice(0, 10)) lines.push(`${entry.at} | ${entry.context} | ${entry.code || 'sin código'} | ${entry.message}`);
  }
  return lines.join('\n');
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function showDiagnostic() {
  try {
    const report = await buildDiagnosticReport();
    $('#diagnosticOutput').textContent = report;
    const dialog = $('#diagnosticDialog');
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    recordError('diagnostic', error);
    toast(`No se pudo generar el diagnóstico: ${error.message}`);
  }
}

function showUpdateAvailable() {
  $('#updateBanner')?.classList.remove('hidden');
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
  state.lastSyncAt = Number(localStorage.getItem(lastSyncKey()) || 0);
  applyPrivacyMode();
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
$('#resultForm select[name="campaignId"]').addEventListener('change', () => { updateSeriesFields(); renderWinnerSummary(); });
$('#saleForm select[name="campaignId"]').addEventListener('change', updateSeriesFields);
$('#campaignForm input[name="factorEnabled"]').addEventListener('change', event => updateFactorField({ clearWhenDisabled: !event.currentTarget.checked }));

$('#campaignForm').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const numberMin = Number(form.get('numberMin'));
  const numberMax = Number(form.get('numberMax'));
  const numberWidth = Number(form.get('numberWidth'));
  const factorEnabled = form.get('factorEnabled') === 'on';
  const factorText = String(form.get('factor') ?? '').trim();
  let factor = null;
  if (!Number.isInteger(numberMin) || !Number.isInteger(numberMax) || numberMin < 0 || numberMax < numberMin) return toast('Revisa el rango numérico.');
  if (factorEnabled) {
    if (!factorText) return toast('Escribe el factor de la campaña.');
    factor = Number(factorText);
    if (!Number.isFinite(factor) || factor < 0) return toast('El factor debe ser un número mayor o igual que 0.');
  }
  const campaign = {
    id: makeId('campaign'),
    name: String(form.get('name') || '').trim(),
    numberMin,
    numberMax,
    numberWidth,
    useSeries: String(form.get('useSeries') || 'false') === 'true',
    eligibility: String(form.get('eligibility') || 'paid'),
    allowRepeated: form.get('allowRepeated') === 'on',
    factorEnabled,
    factor,
    notes: String(form.get('notes') || '').trim(),
    status: 'active',
    deleted: false
  };
  await saveEntity('campaigns', campaign, 'Campaña creada.', 'campaign.created');
  formElement.reset();
  formElement.numberMin.value = 0;
  formElement.numberMax.value = 99;
  formElement.numberWidth.value = 2;
  formElement.useSeries.value = 'false';
  formElement.allowRepeated.checked = true;
  formElement.factorEnabled.checked = false;
  formElement.factor.value = '';
  updateFactorField({ clearWhenDisabled: true });
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
  let series;
  let phone;
  try {
    number = numberForCampaign(form.get('number'), campaign);
    series = seriesForCampaign(form.get('series'), campaign);
    phone = validatePhone(form.get('phone'));
  } catch (error) { return toast(error.message); }
  if (!campaign.allowRepeated) {
    const alreadyUsed = state.data.sales.some(sale => !sale.deleted && sale.campaignId === campaign.id && sale.number === number && String(sale.series || '') === series && sale.paymentStatus !== 'cancelled');
    if (alreadyUsed) return toast(`${numberSeriesLabel(number, series, campaign)} ya fue registrado en esta campaña.`);
  }
  const quantity = Number(form.get('quantity'));
  const amount = Number(form.get('amount'));
  if (!Number.isInteger(quantity) || quantity < 1) return toast('La cantidad debe ser un entero mayor que cero.');
  if (!Number.isFinite(amount) || amount < 0) return toast('El monto no es válido.');
  const sale = {
    id: makeId('sale'),
    campaignId: campaign.id,
    number,
    series,
    quantity,
    customerName: String(form.get('customerName') || '').trim(),
    phone,
    amount,
    paymentStatus: String(form.get('paymentStatus') || 'pending'),
    notes: String(form.get('notes') || '').trim(),
    sellerId: state.user.uid,
    sellerName: state.actor.name,
    deleted: false
  };
  await saveEntity('sales', sale, `${numberSeriesLabel(number, series, campaign)} registrado.`, 'sale.created');
  event.currentTarget.reset();
  event.currentTarget.quantity.value = 1;
  event.currentTarget.amount.value = 0;
  updateSeriesFields();
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
  const seriesField = $('[data-series-field="edit"]');
  const seriesInput = form.elements.namedItem('series');
  const campaign = getCampaign(sale.campaignId);
  const usesSeries = campaignUsesSeries(campaign);
  seriesField?.classList.toggle('hidden', !usesSeries);
  seriesInput.required = usesSeries;
  seriesInput.value = sale.series || '';
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
  let series;
  let phone;
  try {
    number = numberForCampaign(form.get('number'), campaign);
    series = seriesForCampaign(form.get('series'), campaign);
    phone = validatePhone(form.get('phone'));
  } catch (error) { return toast(error.message); }
  if (!campaign.allowRepeated) {
    const duplicate = state.data.sales.some(item => !item.deleted && item.id !== sale.id && item.campaignId === campaign.id && item.number === number && String(item.series || '') === series && item.paymentStatus !== 'cancelled');
    if (duplicate) return toast(`${numberSeriesLabel(number, series, campaign)} ya fue registrado en esta campaña.`);
  }
  const updated = {
    ...sale,
    customerName: String(form.get('customerName') || '').trim(),
    phone,
    number,
    series,
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
  let winningSeries;
  try {
    winningNumber = numberForCampaign(form.get('winningNumber'), campaign);
    winningSeries = seriesForCampaign(form.get('winningSeries'), campaign);
  } catch (error) { return toast(error.message); }
  let result = state.data.results.find(item => !item.deleted && item.campaignId === campaign.id);
  if (result) {
    const queryChanged = result.winningNumber !== winningNumber || String(result.winningSeries || '') !== String(winningSeries || '');
    if (queryChanged) {
      const relatedDeliveries = state.data.deliveries.filter(delivery => !delivery.deleted && delivery.resultId === result.id);
      await Promise.all(relatedDeliveries.map(delivery => saveEntity('deliveries', { ...delivery, deleted: true }, '', 'delivery.cleared')));
    }
    result = { ...result, winningNumber, winningSeries, notes: String(form.get('notes') || '').trim() };
  } else {
    result = { id: makeId('result'), campaignId: campaign.id, winningNumber, winningSeries, notes: String(form.get('notes') || '').trim(), deleted: false };
  }
  await saveEntity('results', result, `Consulta de ${numberSeriesLabel(winningNumber, winningSeries, campaign)} guardada.`, 'result.saved');
});

$('#winnerSummary').addEventListener('click', async event => {
  const saveManualButton = event.target.closest('[data-save-manual-result]');
  if (saveManualButton) {
    const resultId = saveManualButton.dataset.resultId;
    const groupKey = saveManualButton.dataset.saveManualResult;
    const activeResult = currentResult();
    if (!activeResult || activeResult.id !== resultId || !winnerGroups(activeResult).some(group => group.key === groupKey)) {
      return toast('La coincidencia ya no está disponible. Actualiza la consulta.');
    }
    const input = saveManualButton.closest('.winner-card')?.querySelector('[data-manual-result-input]');
    const rawValue = String(input?.value ?? '').trim();
    if (!rawValue) return toast('Escribe el resultado manual.');
    const manualResult = Number(rawValue);
    if (!Number.isFinite(manualResult) || manualResult < 0) return toast('El resultado manual debe ser un número mayor o igual que 0.');
    let delivery = deliveryFor(resultId, groupKey);
    if (!delivery) {
      delivery = {
        id: makeId('delivery'),
        resultId,
        groupKey,
        delivered: false,
        manualResult,
        manualResultUpdatedAt: now(),
        manualResultUpdatedBy: state.actor.name,
        deleted: false
      };
    } else {
      delivery = {
        ...delivery,
        manualResult,
        manualResultUpdatedAt: now(),
        manualResultUpdatedBy: state.actor.name
      };
    }
    await saveEntity('deliveries', delivery, 'Resultado manual guardado.', 'delivery.manualResultUpdated');
    return;
  }

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
$('#winnerCsvBtn').addEventListener('click', exportCoincidencesCsv);
$('#salesPrintBtn').addEventListener('click', () => openPrintOptions('sales'));
$('#winnerPrintBtn').addEventListener('click', () => openPrintOptions('result'));
$('#printAllBtn').addEventListener('click', () => openPrintOptions('dashboard'));
$('#migrateLegacyBtn').addEventListener('click', migrateLegacyData);

$('#importJsonInput').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  try {
    if (file.size > IMPORT_MAX_BYTES) throw new Error('El respaldo supera el límite de 20 MB.');
    const text = await file.text();
    const parsed = JSON.parse(text);
    const plan = prepareImportData(parsed);
    state.pendingImportPlan = plan;
    renderImportPreview(plan);
    $('#importPreviewDialog').showModal();
  } catch (error) {
    recordError('import.preview', error);
    toast(`No se pudo revisar el respaldo: ${error.message}`);
  } finally {
    input.value = '';
    input.disabled = false;
  }
});

$('#confirmImportBtn')?.addEventListener('click', async event => {
  if (!state.pendingImportPlan || event.currentTarget.dataset.busy === '1') return;
  event.currentTarget.dataset.busy = '1';
  event.currentTarget.disabled = true;
  try {
    await savePreparedImport(state.pendingImportPlan);
    state.pendingImportPlan = null;
    $('#importPreviewDialog').close();
  } catch (error) {
    recordError('import.commit', error);
    toast(`No se pudo importar: ${error.message}`);
  } finally {
    event.currentTarget.dataset.busy = '0';
    event.currentTarget.disabled = false;
  }
});
$('#cancelImportBtn')?.addEventListener('click', () => {
  state.pendingImportPlan = null;
  $('#importPreviewDialog').close();
});
$('#closeImportPreviewBtn')?.addEventListener('click', () => {
  state.pendingImportPlan = null;
  $('#importPreviewDialog').close();
});

$('#printOptionsForm')?.addEventListener('submit', event => {
  event.preventDefault();
  performPrint();
});
$('#cancelPrintOptionsBtn')?.addEventListener('click', () => $('#printOptionsDialog').close());
$('#closePrintOptionsBtn')?.addEventListener('click', () => $('#printOptionsDialog').close());
window.addEventListener('afterprint', clearPrintState);

$('#privacyBtn')?.addEventListener('click', () => {
  state.privacyMode = !state.privacyMode;
  sessionStorage.setItem('numina_privacy_mode', state.privacyMode ? '1' : '0');
  applyPrivacyMode();
  toast(state.privacyMode ? 'Información sensible oculta en pantalla.' : 'Información sensible visible.');
});

$('#diagnosticBtn')?.addEventListener('click', showDiagnostic);
$('#closeDiagnosticBtn')?.addEventListener('click', () => $('#diagnosticDialog').close());
$('#copyDiagnosticBtn')?.addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#diagnosticOutput').textContent || '');
  toast('Diagnóstico copiado.');
});
$('#downloadDiagnosticBtn')?.addEventListener('click', () => {
  download(`numina-diagnostico-${new Date().toISOString().slice(0, 10)}.txt`, $('#diagnosticOutput').textContent || '', 'text/plain;charset=utf-8');
});
$('#clearErrorLogBtn')?.addEventListener('click', () => {
  localStorage.removeItem(errorLogKey());
  showDiagnostic();
  toast('Registro local de errores limpiado.');
});

$('#updateNowBtn')?.addEventListener('click', () => location.reload());

$$('input[name="phone"]').forEach(input => {
  input.classList.add('sensitive-value', 'sensitive-phone');
  input.addEventListener('blur', () => {
    input.value = cleanPhone(input.value);
    if (input.value && normalizePhone(input.value).length < 7) toast('Revisa el teléfono: parece demasiado corto.');
  });
});
$$('input[name="amount"]').forEach(input => input.classList.add('sensitive-value', 'sensitive-amount'));

const guardedForms = new Set(['campaignForm', 'saleForm', 'editSaleForm', 'resultForm', 'keyForm']);
document.addEventListener('submit', event => {
  const form = event.target;
  if (!guardedForms.has(form.id)) return;
  const current = Date.now();
  const last = Number(form.dataset.lastSubmitAt || 0);
  if (current - last < 2500) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toast('La operación ya está en curso.');
    return;
  }
  form.dataset.lastSubmitAt = String(current);
}, true);

document.addEventListener('click', event => {
  const button = event.target.closest('[data-save-manual-result], [data-delivery-key]');
  if (!button) return;
  const current = Date.now();
  const last = Number(button.dataset.lastActionAt || 0);
  if (current - last < 3000) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toast('La operación ya está en curso.');
    return;
  }
  button.dataset.lastActionAt = String(current);
}, true);

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

window.addEventListener('error', event => recordError('window.error', event.error || event.message));
window.addEventListener('unhandledrejection', event => recordError('promise.unhandled', event.reason));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      state.serviceWorkerRegistration = registration;
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateAvailable();
        });
      });
      setInterval(() => registration.update().catch(error => recordError('serviceWorker.update', error)), 30 * 60000);
    } catch (error) {
      console.error('Service Worker:', error);
      recordError('serviceWorker.register', error);
    }
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'NUMINA_UPDATE_READY') showUpdateAvailable();
  });
}

updateConnectionUi();
applyPrivacyMode();
refreshInstallButtons();
