import { $, $$, state, APP_VERSION, ENTRY_MODE, LEGACY_STORAGE_KEY } from './context.js';
import { toast, paymentLabel, campaignStatusLabel, formatDate, formatAmount, escapeHtml, normalizeText, now, readErrorLog, recordError, humanDuration, leaseRemaining, isAdmin, currentDeviceName, leaseHours, updateConnectionUi } from './core.js';
import { pendingWriteCount, updateLeaseUi } from './data.js';
import { visibleSales, visibleCampaigns, activeCampaigns, getCampaign, campaignUsesSeries, campaignFactorEnabled, campaignFactor, formatPlainNumber, campaignFactorLabel, hasManualResult, manualResultValue, numberSeriesLabel, currentResult, winnerGroups, deliveryFor } from './domain.js';

const uiHooks = { refreshDevices: async () => {} };
function registerUiHooks(hooks = {}) { Object.assign(uiHooks, hooks); }

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
  if (viewName === 'devices' && isAdmin()) uiHooks.refreshDevices();
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


export { registerUiHooks, updateFactorField, updateSeriesFields, showView, populateCampaignSelect, renderAll, renderDashboard, renderCampaigns, filteredSales, renderSales, renderWinnerSummary, download, cleanExportItem, exportCampaign, exportDelivery, exportJson, csvCell, exportCsv, exportCoincidencesCsv, openPrintOptions, clearPrintState, performPrint, buildDiagnosticReport, formatBytes, showDiagnostic, showUpdateAvailable, refreshInstallButtons, requestInstall };
