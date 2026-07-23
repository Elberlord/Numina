import { doc, getDoc, getDocFromServer, setDoc, updateDoc, collection, serverTimestamp, addDoc, onSnapshot, writeBatch, runTransaction } from 'firebase/firestore';
import { auth, db, $, state, APP_VERSION, ADMIN_UID, ADMIN_DEVICE_NAME_KEY, ENTITY_COLLECTIONS, IMPORT_MAX_BYTES, IMPORT_ID_PATTERN } from './context.js';
import { currentDeviceId, currentDeviceName, defaultDeviceName, actorNameKey, pinKey, leaseKey, showOnly, updateConnectionUi, leaseRemaining, leaseHours, storeLease, clearLocalAccess, showBlocked, showPendingRequest, showRequestForm, showPinUnlock, showPinSetup, now, readJson, storeLastSync, recordError, toast, escapeHtml, formatDate, accessWhatsAppUrl, normalizeActivationKey, sha256, humanDuration } from './core.js';

const dataHooks = { renderAll: () => {} };
function registerDataHooks(hooks = {}) { Object.assign(dataHooks, hooks); }

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
        dataHooks.renderAll();
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


function cleanStoredItem(item) {
  const copy = { ...item };
  delete copy._pending;
  delete copy.serverCreatedAt;
  delete copy.serverUpdatedAt;
  return copy;
}

function importedFieldsMatch(collectionName, imported, existing) {
  if (!existing) return false;
  const ignored = new Set(['updatedAt', 'updatedByUid', 'updatedByName', 'updatedByDevice', 'serverUpdatedAt', '_pending']);
  const normalizedExisting = normalizeImportedEntity(collectionName, cleanStoredItem(existing));
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


export { registerDataHooks, validateAdminOnline, evaluateAccess, watchOwnDevice, submitDeviceRequest, activateWithTemporaryKey, startLeaseTimer, updateLeaseUi, writeAudit, stopDataSync, startDataSync, pendingWriteCount, updateSyncUi, actorFields, saveEntity, normalizeImportedEntity, isPlainObject, hasForbiddenImportKey, importRecordErrors, stableValue, importedFieldsMatch, prepareImportData, savePreparedImport, saveManyFromData, renderImportPreview };
