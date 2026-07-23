import { signOut } from 'firebase/auth';
import { auth, $, $$, state, APP_VERSION, ACCESS_WHATSAPP, ADMIN_DEVICE_ID_KEY, ADMIN_DEVICE_NAME_KEY, PIN_FAILURES_PREFIX, PIN_ITERATIONS, ERROR_LOG_PREFIX, LAST_SYNC_PREFIX } from './context.js';

const coreHooks = {
  updateSyncUi: () => {},
  stopDataSync: () => {},
  evaluateAccess: async (_options = {}) => {}
};

function registerCoreHooks(hooks = {}) {
  Object.assign(coreHooks, hooks);
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
  const platform = /** @type {any} */ (navigator).userAgentData?.platform || navigator.platform || 'Dispositivo';
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

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
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
  coreHooks.updateSyncUi();
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
  coreHooks.stopDataSync();
  setGate(title, message, [
    ['Cuenta', state.user?.email || state.actor?.name || 'Dispositivo'],
    ['Código', (state.user?.uid || '').slice(0, 8).toUpperCase() || '—'],
    ['Conexión', navigator.onLine ? 'En línea' : 'Sin conexión']
  ], `<button id="retryAccessBtn" class="primary" type="button">Comprobar acceso</button><button id="blockedSignOutBtn" class="ghost" type="button">Cambiar de cuenta</button>`);
  $('#retryAccessBtn').onclick = () => coreHooks.evaluateAccess({ forceServer: true });
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


export { registerCoreHooks, now, makeId, readJson, writeJson, userKey, pinKey, leaseKey, actorNameKey, getAdminDeviceId, defaultDeviceName, currentDeviceId, currentDeviceName, isAdmin, currentUser, sha256, bytesToBase64, base64ToBytes, derivePinHash, createPinRecord, verifyStoredPin, errorLogKey, sanitizeErrorMessage, readErrorLog, recordError, lastSyncKey, storeLastSync, cleanPhone, validatePhone, applyPrivacyMode, normalizeActivationKey, generateActivationKey, activationKeyWhatsAppUrl, escapeHtml, normalizeText, normalizePhone, accessWhatsAppUrl, formatDate, formatAmount, paymentLabel, campaignStatusLabel, humanDuration, toast, showOnly, updateConnectionUi, authErrorMessage, leaseHours, leaseRemaining, storeLease, clearLocalAccess, gateDetail, setGate, showBlocked, showPendingRequest, showActivationForm, showRequestForm, showPinSetup, showPinUnlock, readPinFailures, savePinFailures };
