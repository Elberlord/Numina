import { $, state } from './context.js';
import { normalizePhone, normalizeText } from './core.js';

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


export { visibleSales, visibleCampaigns, activeCampaigns, getCampaign, numberForCampaign, campaignUsesSeries, campaignFactorEnabled, campaignFactor, formatPlainNumber, campaignFactorLabel, hasManualResult, manualResultValue, seriesForCampaign, numberSeriesLabel, currentResult, winnerGroups, deliveryFor };
