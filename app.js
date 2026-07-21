'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const STORAGE_KEY = 'numina_github_pages_data_v1';
const CURRENT_USER_KEY = 'numina_github_pages_current_user_v1';

const state = {
  data: loadData(),
  currentUserId: localStorage.getItem(CURRENT_USER_KEY) || '',
  unlocked: false,
  activeView: 'dashboard',
  deferredInstallPrompt: null
};

function emptyData() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    users: [],
    campaigns: [],
    sales: [],
    results: [],
    deliveries: []
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : emptyData();
    return { ...emptyData(), ...parsed };
  } catch (error) {
    console.error('No se pudo leer la base local', error);
    return emptyData();
  }
}

function saveData(message = '') {
  state.data.updatedAt = now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  $('#storageBadge').textContent = 'Guardado local';
  if (message) toast(message);
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function sha256(text) {
  if (crypto?.subtle) {
    const bytes = new TextEncoder().encode(String(text));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 5381;
  for (const character of String(text)) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return `fallback_${hash >>> 0}`;
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

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
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

function roleLabel(role) {
  return role === 'admin' ? 'Administrador' : 'Vendedora';
}

function campaignStatusLabel(status) {
  return status === 'active' ? 'Activa' : 'Cerrada';
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}

function currentUser() {
  return state.data.users.find(user => user.id === state.currentUserId && user.active !== false) || null;
}

function isAdmin() {
  return currentUser()?.role === 'admin';
}

function visibleSales() {
  const user = currentUser();
  if (!user) return [];
  return state.data.sales.filter(sale => !sale.deleted && (user.role === 'admin' || sale.sellerId === user.id));
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

function getUser(userId) {
  return state.data.users.find(user => user.id === userId) || null;
}

function numberForCampaign(value, campaign) {
  const numeric = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(numeric)) throw new Error('El número no es válido.');
  if (numeric < Number(campaign.numberMin) || numeric > Number(campaign.numberMax)) {
    throw new Error(`El número debe estar entre ${campaign.numberMin} y ${campaign.numberMax}.`);
  }
  return String(numeric).padStart(Number(campaign.numberWidth || 1), '0');
}

function updateConnectionUi() {
  const online = navigator.onLine;
  const banner = $('#connectionBanner');
  banner.className = `status-banner ${online ? 'online' : 'offline'}`;
  banner.textContent = online
    ? '● Con conexión: la aplicación puede actualizar sus archivos instalados.'
    : '● Sin conexión: la aplicación sigue usando los datos guardados en este dispositivo.';
  $('#networkState').textContent = online ? '● Con conexión' : '● Sin conexión';
}

function populateLoginUsers() {
  const select = $('#loginForm select[name="userId"]');
  const users = state.data.users.filter(user => user.active !== false);
  select.innerHTML = users.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} — ${roleLabel(user.role)}</option>`).join('');
  const preferred = users.some(user => user.id === state.currentUserId) ? state.currentUserId : users[0]?.id;
  if (preferred) select.value = preferred;
}

function showAuth() {
  state.unlocked = false;
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  const hasUsers = state.data.users.length > 0;
  $('#setupForm').classList.toggle('hidden', hasUsers);
  $('#loginForm').classList.toggle('hidden', !hasUsers);
  if (hasUsers) populateLoginUsers();
  updateConnectionUi();
}

function enterApp() {
  const user = currentUser();
  if (!user) return showAuth();
  state.unlocked = true;
  localStorage.setItem(CURRENT_USER_KEY, user.id);
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  renderAll();
}

function showView(viewName) {
  if (!isAdmin() && ['campaigns', 'result', 'users'].includes(viewName)) viewName = 'dashboard';
  state.activeView = viewName;
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));
  $$('#nav button').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
  $('#sidebar').classList.remove('open');
  if (viewName === 'result') renderWinnerSummary();
  if (viewName === 'sales') renderSales();
}

function populateCampaignSelect(select, { includeAll = false, activeOnly = false } = {}) {
  const previous = select.value;
  const campaigns = activeOnly ? activeCampaigns() : visibleCampaigns();
  const options = [];
  if (includeAll) options.push('<option value="all">Todas las campañas</option>');
  options.push(...campaigns.map(campaign => `<option value="${campaign.id}">${escapeHtml(campaign.name)}</option>`));
  if (!campaigns.length && !includeAll) options.push('<option value="">No hay campañas disponibles</option>');
  select.innerHTML = options.join('');
  if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
}

function renderAll() {
  const user = currentUser();
  if (!user) return showAuth();

  $('#userName').textContent = user.name;
  $('#userRole').textContent = roleLabel(user.role);
  $('#userAvatar').textContent = user.name.trim().charAt(0).toUpperCase() || 'U';

  $$('[data-admin-only]').forEach(element => element.classList.toggle('hidden', !isAdmin()));
  $$('[data-admin-only-block]').forEach(element => element.classList.toggle('hidden', !isAdmin()));
  $('#importCard').classList.toggle('hidden', !isAdmin());

  const active = activeCampaigns()[0];
  $('#activeCampaignLabel').textContent = active ? active.name : 'Sin campaña activa';

  populateCampaignSelect($('#dashboardCampaignFilter'), { includeAll: true });
  populateCampaignSelect($('#salesCampaignFilter'), { includeAll: true });
  populateCampaignSelect($('#saleForm select[name="campaignId"]'), { activeOnly: true });
  populateCampaignSelect($('#resultForm select[name="campaignId"]'));

  renderDashboard();
  renderSales();
  renderCampaigns();
  renderUsers();
  renderWinnerSummary();
  updateConnectionUi();

  if (!isAdmin() && ['campaigns', 'result', 'users'].includes(state.activeView)) showView('dashboard');
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

  const recent = [...sales].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 8);
  $('#recentSales').innerHTML = recent.length ? recent.map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return `<div class="list-item"><div><strong>${escapeHtml(sale.customerName)}</strong><small>${escapeHtml(campaign?.name || 'Campaña')} · Número ${escapeHtml(sale.number)} · ${escapeHtml(sale.sellerName)}</small></div><span class="status-pill ${sale.paymentStatus}">${paymentLabel(sale.paymentStatus)}</span></div>`;
  }).join('') : '<div class="empty">Todavía no hay ventas registradas.</div>';

  const storageSize = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
  $('#localSummary').innerHTML = `
    <div class="sync-line"><span>Último guardado</span><strong>${formatDate(state.data.updatedAt)}</strong></div>
    <div class="sync-line"><span>Datos almacenados</span><strong>${Math.max(1, Math.round(storageSize / 1024))} KB</strong></div>
    <div class="sync-line"><span>Conexión actual</span><strong>${navigator.onLine ? 'En línea' : 'Sin conexión'}</strong></div>
    <p class="storage-note">En esta versión de GitHub Pages no existe sincronización automática entre teléfonos.</p>`;
}

function renderCampaigns() {
  const container = $('#campaignList');
  const campaigns = visibleCampaigns().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
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
        <span class="meta-chip">${campaign.eligibility === 'paid' ? 'Solo pagadas' : 'Pagadas y pendientes'}</span>
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
  const query = normalizeText($('#salesSearch').value);
  return visibleSales().filter(sale => {
    if (campaignFilter !== 'all' && sale.campaignId !== campaignFilter) return false;
    if (statusFilter !== 'all' && sale.paymentStatus !== statusFilter) return false;
    if (query) {
      const haystack = normalizeText([sale.number, sale.customerName, sale.phone, sale.sellerName].join(' '));
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function renderSales() {
  const sales = filteredSales();
  const header = '<div class="table-row header"><span>Número</span><span>Cliente</span><span>Teléfono</span><span>Cantidad</span><span>Monto</span><span>Estado</span><span>Acción</span></div>';
  const rows = sales.map(sale => `<div class="table-row">
    <span><span class="number-chip">${escapeHtml(sale.number)}</span></span>
    <span><strong>${escapeHtml(sale.customerName)}</strong><small>${escapeHtml(sale.sellerName)} · ${formatDate(sale.createdAt)}</small></span>
    <span>${escapeHtml(sale.phone || '—')}</span>
    <span>${Number(sale.quantity || 0)}</span>
    <span>${formatAmount(sale.amount)}</span>
    <span><span class="status-pill ${sale.paymentStatus}">${paymentLabel(sale.paymentStatus)}</span></span>
    <span class="table-actions"><button data-edit-sale="${sale.id}" title="Editar">✎</button></span>
  </div>`).join('');
  $('#salesTable').innerHTML = sales.length ? header + rows : '<div class="empty">No hay ventas con esos filtros.</div>';
}

function renderUsers() {
  const container = $('#userList');
  const users = [...state.data.users].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  container.innerHTML = users.map(user => `<article class="user-item">
    <header><div><h3>${escapeHtml(user.name)}</h3><span class="status-pill ${user.active === false ? 'cancelled' : 'paid'}">${user.active === false ? 'Desactivado' : roleLabel(user.role)}</span></div><div class="avatar">${escapeHtml(user.name.charAt(0).toUpperCase())}</div></header>
    <p class="muted">Creado ${formatDate(user.createdAt)}. Este acceso solo existe en este dispositivo.</p>
    <div class="card-actions">
      <button class="secondary" data-user-toggle="${user.id}" ${user.id === state.currentUserId ? 'disabled' : ''}>${user.active === false ? 'Activar' : 'Desactivar'}</button>
    </div>
  </article>`).join('');
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
    const existing = groups.get(key) || {
      key,
      customerName: sale.customerName,
      phone: sale.phone,
      quantity: 0,
      amount: 0,
      sellers: new Set(),
      sales: []
    };
    existing.quantity += Number(sale.quantity || 0);
    existing.amount += Number(sale.amount || 0);
    existing.sellers.add(sale.sellerName);
    existing.sales.push(sale);
    if (!existing.phone && sale.phone) existing.phone = sale.phone;
    groups.set(key, existing);
  }

  return Array.from(groups.values()).map(group => ({ ...group, sellers: Array.from(group.sellers) }));
}

function deliveryFor(resultId, groupKey) {
  return state.data.deliveries.find(delivery => delivery.resultId === resultId && delivery.groupKey === groupKey) || null;
}

function renderWinnerSummary() {
  const select = $('#resultForm select[name="campaignId"]');
  const campaign = getCampaign(select.value);
  const result = currentResult();
  const container = $('#winnerSummary');
  if (!campaign) {
    container.innerHTML = '<div class="panel empty">Crea una campaña para registrar un resultado.</div>';
    return;
  }
  if (!result) {
    container.innerHTML = '<div class="panel empty">Esta campaña todavía no tiene un resultado registrado.</div>';
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
        <div><span>Vendedora(s)</span><strong>${escapeHtml(group.sellers.join(', '))}</strong></div>
        <div><span>Monto registrado</span><strong>${formatAmount(group.amount)}</strong></div>
      </div>
      <div class="card-actions"><button class="${delivery?.delivered ? 'ghost' : 'primary'}" data-delivery-key="${escapeHtml(group.key)}" data-result-id="${result.id}">${delivery?.delivered ? 'Marcar pendiente' : 'Marcar entregado'}</button></div>
    </article>`;
  }).join('');

  container.innerHTML = `
    <div class="winner-overview">
      <article class="winner-stat"><span>Número registrado</span><strong>${escapeHtml(result.winningNumber)}</strong></article>
      <article class="winner-stat"><span>Personas coincidentes</span><strong>${groups.length}</strong></article>
      <article class="winner-stat"><span>Entregas pendientes</span><strong>${pendingDeliveries}</strong></article>
    </div>
    <article class="panel"><p><strong>Total de participaciones coincidentes:</strong> ${totalParticipations}</p>${result.notes ? `<p class="muted">${escapeHtml(result.notes)}</p>` : ''}</article>
    <div class="winner-list">${cards || '<div class="panel empty">No hay ventas elegibles con ese número.</div>'}</div>`;
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

function exportJson() {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`numina-respaldo-${stamp}.json`, JSON.stringify(state.data, null, 2), 'application/json');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const headers = ['Fecha', 'Campaña', 'Número', 'Cliente', 'Teléfono', 'Participaciones', 'Monto', 'Estado', 'Vendedora', 'Notas'];
  const rows = visibleSales().map(sale => {
    const campaign = getCampaign(sale.campaignId);
    return [sale.createdAt, campaign?.name || '', sale.number, sale.customerName, sale.phone, sale.quantity, sale.amount, paymentLabel(sale.paymentStatus), sale.sellerName, sale.notes].map(csvCell).join(',');
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
  ['#installBtn', '#installAuthBtn', '#installBackupBtn'].forEach(selector => $(selector)?.classList.toggle('hidden', !show));
}

async function requestInstall() {
  if (!state.deferredInstallPrompt) {
    toast('En Chrome, abre el menú y elige “Instalar aplicación” o “Agregar a pantalla principal”.');
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  refreshInstallButtons();
}

$('#setupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get('name') || '').trim();
  const pin = String(form.get('pin') || '');
  const pinConfirm = String(form.get('pinConfirm') || '');
  if (!/^\d{4,8}$/.test(pin)) return toast('El PIN debe tener entre 4 y 8 números.');
  if (pin !== pinConfirm) return toast('Los PIN no coinciden.');
  const user = { id: makeId('user'), name, role: 'admin', pinHash: await sha256(pin), active: true, createdAt: now() };
  state.data.users.push(user);
  state.currentUserId = user.id;
  saveData('Administrador creado.');
  enterApp();
});

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const user = getUser(String(form.get('userId') || ''));
  const pinHash = await sha256(String(form.get('pin') || ''));
  if (!user || user.active === false || user.pinHash !== pinHash) return toast('Usuario o PIN incorrecto.');
  state.currentUserId = user.id;
  event.currentTarget.reset();
  enterApp();
});

$('#lockBtn').addEventListener('click', showAuth);
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

$('#campaignForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!isAdmin()) return;
  const form = new FormData(event.currentTarget);
  const numberMin = Number(form.get('numberMin'));
  const numberMax = Number(form.get('numberMax'));
  const numberWidth = Number(form.get('numberWidth'));
  if (!Number.isInteger(numberMin) || !Number.isInteger(numberMax) || numberMin < 0 || numberMax < numberMin) return toast('Revisa el rango numérico.');
  state.data.campaigns.push({
    id: makeId('campaign'),
    name: String(form.get('name') || '').trim(),
    numberMin,
    numberMax,
    numberWidth,
    eligibility: String(form.get('eligibility') || 'paid'),
    allowRepeated: form.get('allowRepeated') === 'on',
    notes: String(form.get('notes') || '').trim(),
    status: 'active',
    createdAt: now(),
    createdBy: state.currentUserId
  });
  event.currentTarget.reset();
  event.currentTarget.numberMin.value = 0;
  event.currentTarget.numberMax.value = 99;
  event.currentTarget.numberWidth.value = 2;
  event.currentTarget.allowRepeated.checked = true;
  saveData('Campaña creada.');
  renderAll();
});

$('#campaignList').addEventListener('click', event => {
  if (!isAdmin()) return;
  const toggle = event.target.closest('[data-campaign-toggle]');
  const remove = event.target.closest('[data-campaign-delete]');
  if (toggle) {
    const campaign = getCampaign(toggle.dataset.campaignToggle);
    if (campaign) {
      campaign.status = campaign.status === 'active' ? 'closed' : 'active';
      campaign.updatedAt = now();
      saveData('Estado de campaña actualizado.');
      renderAll();
    }
  }
  if (remove) {
    const campaign = getCampaign(remove.dataset.campaignDelete);
    if (!campaign) return;
    const hasSales = state.data.sales.some(sale => !sale.deleted && sale.campaignId === campaign.id);
    if (hasSales) return toast('No se puede eliminar una campaña con ventas.');
    if (confirm(`¿Eliminar la campaña “${campaign.name}”?`)) {
      campaign.deleted = true;
      saveData('Campaña eliminada.');
      renderAll();
    }
  }
});

$('#saleForm').addEventListener('submit', event => {
  event.preventDefault();
  const user = currentUser();
  const form = new FormData(event.currentTarget);
  const campaign = getCampaign(String(form.get('campaignId') || ''));
  if (!campaign || campaign.status !== 'active') return toast('Selecciona una campaña activa.');
  let number;
  try {
    number = numberForCampaign(form.get('number'), campaign);
  } catch (error) {
    return toast(error.message);
  }
  if (!campaign.allowRepeated) {
    const alreadyUsed = state.data.sales.some(sale => !sale.deleted && sale.campaignId === campaign.id && sale.number === number && sale.paymentStatus !== 'cancelled');
    if (alreadyUsed) return toast(`El número ${number} ya fue registrado en esta campaña.`);
  }
  const quantity = Number(form.get('quantity'));
  const amount = Number(form.get('amount'));
  if (!Number.isInteger(quantity) || quantity < 1) return toast('La cantidad debe ser un entero mayor que cero.');
  if (!Number.isFinite(amount) || amount < 0) return toast('El monto no es válido.');
  state.data.sales.push({
    id: makeId('sale'),
    campaignId: campaign.id,
    number,
    quantity,
    customerName: String(form.get('customerName') || '').trim(),
    phone: String(form.get('phone') || '').trim(),
    amount,
    paymentStatus: String(form.get('paymentStatus') || 'pending'),
    notes: String(form.get('notes') || '').trim(),
    sellerId: user.id,
    sellerName: user.name,
    createdAt: now(),
    updatedAt: now()
  });
  event.currentTarget.reset();
  event.currentTarget.quantity.value = 1;
  event.currentTarget.amount.value = 0;
  saveData(`Número ${number} registrado.`);
  renderAll();
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

$('#editSaleForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const sale = visibleSales().find(item => item.id === form.get('id'));
  if (!sale) return toast('No se encontró la venta.');
  const campaign = getCampaign(sale.campaignId);
  let number;
  try {
    number = numberForCampaign(form.get('number'), campaign);
  } catch (error) {
    return toast(error.message);
  }
  sale.customerName = String(form.get('customerName') || '').trim();
  sale.phone = String(form.get('phone') || '').trim();
  sale.number = number;
  sale.quantity = Math.max(1, Number(form.get('quantity')) || 1);
  sale.amount = Math.max(0, Number(form.get('amount')) || 0);
  sale.paymentStatus = String(form.get('paymentStatus') || 'pending');
  sale.notes = String(form.get('notes') || '').trim();
  sale.updatedAt = now();
  saveData('Venta actualizada.');
  $('#editSaleDialog').close();
  renderAll();
});

$('#closeEditDialogBtn').addEventListener('click', () => $('#editSaleDialog').close());
$('#cancelEditDialogBtn').addEventListener('click', () => $('#editSaleDialog').close());

$('#resultForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!isAdmin()) return;
  const form = new FormData(event.currentTarget);
  const campaign = getCampaign(String(form.get('campaignId') || ''));
  if (!campaign) return toast('Selecciona una campaña.');
  let winningNumber;
  try {
    winningNumber = numberForCampaign(form.get('winningNumber'), campaign);
  } catch (error) {
    return toast(error.message);
  }
  let result = state.data.results.find(item => !item.deleted && item.campaignId === campaign.id);
  if (result) {
    result.winningNumber = winningNumber;
    result.notes = String(form.get('notes') || '').trim();
    result.updatedAt = now();
    result.updatedBy = state.currentUserId;
    state.data.deliveries = state.data.deliveries.filter(delivery => delivery.resultId !== result.id);
  } else {
    result = { id: makeId('result'), campaignId: campaign.id, winningNumber, notes: String(form.get('notes') || '').trim(), createdAt: now(), createdBy: state.currentUserId };
    state.data.results.push(result);
  }
  saveData(`Resultado ${winningNumber} registrado.`);
  renderWinnerSummary();
});

$('#winnerSummary').addEventListener('click', event => {
  const button = event.target.closest('[data-delivery-key]');
  if (!button || !isAdmin()) return;
  const resultId = button.dataset.resultId;
  const groupKey = button.dataset.deliveryKey;
  let delivery = deliveryFor(resultId, groupKey);
  if (!delivery) {
    delivery = { id: makeId('delivery'), resultId, groupKey, delivered: true, deliveredAt: now(), deliveredBy: currentUser().name };
    state.data.deliveries.push(delivery);
  } else {
    delivery.delivered = !delivery.delivered;
    delivery.deliveredAt = delivery.delivered ? now() : null;
    delivery.deliveredBy = delivery.delivered ? currentUser().name : null;
  }
  saveData(delivery.delivered ? 'Entrega marcada como realizada.' : 'Entrega marcada como pendiente.');
  renderWinnerSummary();
});

$('#userForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!isAdmin()) return;
  const form = new FormData(event.currentTarget);
  const pin = String(form.get('pin') || '');
  if (!/^\d{4,8}$/.test(pin)) return toast('El PIN debe tener entre 4 y 8 números.');
  state.data.users.push({
    id: makeId('user'),
    name: String(form.get('name') || '').trim(),
    pinHash: await sha256(pin),
    role: String(form.get('role') || 'seller'),
    active: true,
    createdAt: now()
  });
  event.currentTarget.reset();
  saveData('Usuario local creado.');
  renderUsers();
  populateLoginUsers();
});

$('#userList').addEventListener('click', event => {
  const button = event.target.closest('[data-user-toggle]');
  if (!button || !isAdmin()) return;
  const user = getUser(button.dataset.userToggle);
  if (!user || user.id === state.currentUserId) return;
  user.active = user.active === false;
  saveData(user.active ? 'Usuario activado.' : 'Usuario desactivado.');
  renderUsers();
});

$('#exportJsonBtn').addEventListener('click', exportJson);
$('#exportCsvBtn').addEventListener('click', exportCsv);
$('#salesPrintBtn').addEventListener('click', () => printView('sales'));
$('#winnerPrintBtn').addEventListener('click', () => printView('result'));
$('#printAllBtn').addEventListener('click', () => printView('dashboard'));

$('#importJsonInput').addEventListener('change', async event => {
  if (!isAdmin()) return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.sales)) throw new Error('Formato no reconocido');
    if (!confirm('La importación reemplazará todos los datos de este dispositivo. ¿Continuar?')) return;
    state.data = { ...emptyData(), ...parsed, updatedAt: now() };
    const activeAdmin = state.data.users.find(user => user.active !== false && user.role === 'admin');
    state.currentUserId = activeAdmin?.id || state.data.users.find(user => user.active !== false)?.id || '';
    saveData('Respaldo importado.');
    showAuth();
  } catch (error) {
    toast(`No se pudo importar: ${error.message}`);
  } finally {
    event.target.value = '';
  }
});

$('#clearLocalBtn').addEventListener('click', () => {
  if (!isAdmin()) return;
  const confirmation = prompt('Escribe BORRAR para eliminar todos los datos de este dispositivo.');
  if (confirmation !== 'BORRAR') return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
  state.data = emptyData();
  state.currentUserId = '';
  showAuth();
});

['#installBtn', '#installAuthBtn', '#installBackupBtn'].forEach(selector => $(selector)?.addEventListener('click', requestInstall));

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
window.addEventListener('online', () => { updateConnectionUi(); renderDashboard(); });
window.addEventListener('offline', () => { updateConnectionUi(); renderDashboard(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.error('Service Worker:', error)));
}

showAuth();
refreshInstallButtons();
