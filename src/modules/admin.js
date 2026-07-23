import { signOut } from 'firebase/auth';
import { getDocs, query, collection, orderBy, writeBatch, doc, serverTimestamp, Timestamp, updateDoc, getDocFromServer } from 'firebase/firestore';
import { auth, db, $, state, APP_VERSION, LEGACY_STORAGE_KEY } from './context.js';
import { toast, showOnly, showBlocked, lastSyncKey, applyPrivacyMode, isAdmin, formatDate, escapeHtml, generateActivationKey, normalizeActivationKey, sha256, activationKeyWhatsAppUrl, now, clearLocalAccess, updateConnectionUi, leaseRemaining, storeLease, currentDeviceName } from './core.js';
import { startDataSync, startLeaseTimer, writeAudit, saveManyFromData, stopDataSync, updateSyncUi, updateLeaseUi, validateAdminOnline } from './data.js';
import { renderAll, refreshInstallButtons } from './ui.js';

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

export { enterApp, refreshDevices, renderRequests, renderDevices, createTemporaryKey, showGeneratedKey, rejectRequest, toggleDevice, migrateLegacyData, changeAccount, renewAccessSilently };
