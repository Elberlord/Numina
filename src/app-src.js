import { signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, getDocFromServer, serverTimestamp } from 'firebase/firestore';
import { auth, db, $, $$, state, ADMIN_UID, ENTRY_MODE, APP_VERSION, IMPORT_MAX_BYTES } from './modules/context.js';
import { registerCoreHooks, makeId, pinKey, leaseKey, createPinRecord, verifyStoredPin, readPinFailures, savePinFailures, humanDuration, toast, authErrorMessage, applyPrivacyMode, cleanPhone, normalizePhone, updateConnectionUi, leaseRemaining, showBlocked, showActivationForm, showRequestForm, showPendingRequest, showPinUnlock, showOnly, clearLocalAccess, readJson, now, recordError, errorLogKey, validatePhone } from './modules/core.js';
import { registerDataHooks, evaluateAccess, submitDeviceRequest, activateWithTemporaryKey, saveEntity, prepareImportData, savePreparedImport, renderImportPreview, stopDataSync, updateSyncUi } from './modules/data.js';
import { getCampaign, numberForCampaign, seriesForCampaign, numberSeriesLabel, visibleSales, campaignUsesSeries, currentResult, winnerGroups, deliveryFor } from './modules/domain.js';
import { registerUiHooks, updateFactorField, updateSeriesFields, showView, renderAll, renderDashboard, renderSales, renderWinnerSummary, download, exportJson, exportCsv, exportCoincidencesCsv, openPrintOptions, clearPrintState, performPrint, showDiagnostic, showUpdateAvailable, refreshInstallButtons, requestInstall } from './modules/ui.js';
import { enterApp, refreshDevices, rejectRequest, toggleDevice, createTemporaryKey, showGeneratedKey, migrateLegacyData, changeAccount, renewAccessSilently } from './modules/admin.js';

'use strict';

registerCoreHooks({ updateSyncUi, stopDataSync, evaluateAccess });
registerDataHooks({ renderAll });
registerUiHooks({ refreshDevices });

let autoRequestStarted = false;

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
  if (verification.legacy) localStorage.setItem(pinKey(), await createPinRecord(pin));
  savePinFailures({ count: 0, blockedUntil: 0, level: 0 });
  state.unlocked = true;
  enterApp();
  if (verification.legacy && pin.length < 6) toast('PIN antiguo reforzado. Para usar 6 o más dígitos, restablece el acceso local cuando te convenga.');
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
  const form = /** @type {HTMLFormElement} */ (event.target);
  if (!form || !guardedForms.has(form.id)) return;
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
  const target = /** @type {Element | null} */ (event.target);
  const button = /** @type {HTMLElement | null} */ (target?.closest('[data-save-manual-result], [data-delivery-key]'));
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
